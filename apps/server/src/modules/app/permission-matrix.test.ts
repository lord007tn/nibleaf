import { MemberRole } from '@nibleaf/shared/constants';
import { INTEGRATION_PROVIDER_IDS } from '@nibleaf/shared/integrations';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

/**
 * Permission matrix for every dashboard API route.
 *
 * It walks the routes Hono actually registered, so a new route is covered the
 * moment it exists. The caller is a signed-in user whose role in the site's own
 * organization is set per case:
 *  - a Viewer must be turned away from every write before the handler runs;
 *  - a Viewer must be turned away from the reads that carry secrets;
 *  - someone who is not on the site's team must be turned away from every
 *    site route (404, so a site's existence never leaks).
 *
 * The database is a stub that only answers the guard lookups. Every other
 * query rejects, so a route that forgets its guard reaches its handler and
 * fails this test instead of passing by accident.
 */

const state = vi.hoisted(() => ({ role: 'viewer' as string | null }));

vi.mock('@nibleaf/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nibleaf/database')>();
  const unavailable = () => Promise.reject(new Error('permission matrix: handler reached the database'));
  const model = (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      // `then` must stay undefined, or awaiting a model would never settle.
      get: (target, key) => (key === 'then' ? undefined : key in target ? target[key as string] : unavailable),
    });
  const models: Record<string, unknown> = {
    project: model({ findUnique: async () => ({ id: 'project-1', organizationId: 'org-1' }) }),
    member: model({
      findUnique: async () => (state.role ? { id: 'member-1', role: state.role, user: { suspendedAt: null } } : null),
    }),
    user: model({ findUnique: async () => ({ id: 'user-1', role: 'user', suspendedAt: null }) }),
  };
  const prisma = new Proxy(models, {
    get: (target, key) => {
      if (key === 'then') return undefined;
      if (typeof key === 'string' && key.startsWith('$')) return unavailable;
      return target[key as string] ?? model();
    },
  });
  return { ...actual, prisma };
});

const { default: appRoutes } = await import('./index');

const harness = new Hono<HonoEnv>()
  .use(contextStorage())
  .use(async (ctx, next) => {
    ctx.set('user', { id: 'user-1', email: 'viewer@example.com', name: 'Viewer', image: null });
    ctx.set('session', null);
    ctx.set('organizationId', 'org-1');
    ctx.set('membership', null);
    ctx.set('apiKey', null);
    ctx.set('project', null);
    await next();
  })
  .route('/', appRoutes);
harness.onError((error, ctx) =>
  error instanceof AppError
    ? ctx.json({ code: error.code }, error.status)
    : ctx.json({ code: 'unexpected', message: error instanceof Error ? error.message : String(error) }, 500),
);

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const routes = [...new Map(appRoutes.routes.filter((route) => route.method !== 'ALL').map((route) => [`${route.method} ${route.path}`, route])).values()]
  .map(({ method, path }) => ({ method, path }))
  .sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));

/** Writes that act on the caller's OWN account, not on a site the caller
 *  joined, so a site role does not apply. Each one says why. */
const ACCOUNT_SCOPED_WRITES: Record<string, string> = {
  'POST /activation-events': 'records onboarding milestones for the caller only',
  'POST /notifications/read': "marks the caller's own inbox read",
  'POST /projects': 'creates a brand-new site the caller owns',
  'POST /mcp-oauth/grants': 'checked per site in createMcpOAuthGrant: a Viewer role offers no MCP preset (see shared mcp tests)',
};

/** Reads below Editor/Admin because they reveal credentials or admin-only
 *  configuration. A Viewer sees settings read-only, never these. */
const VIEWER_DENIED_READS = [
  'GET /projects/:projectId/api-keys',
  'GET /projects/:projectId/connected-apps',
  'GET /projects/:projectId/integrations',
  'GET /projects/:projectId/integrations/:providerId',
  'GET /projects/:projectId/reader-access',
  'GET /projects/:projectId/settings/ai',
  'GET /projects/:projectId/ai/draft-capability',
  'GET /projects/:projectId/branches/:id/merge-preview',
];

// A concrete URL for a route. `/projects/:id/…` routes take the site id in
// `:id`; under `/projects/:projectId/…` a nested `:id` is a child resource,
// which the guard never reads.
const siteUrlFor = (path: string) =>
  path
    .replace(/^\/projects\/:id(?=\/|$)/, '/projects/project-1')
    .replace(/:projectId/g, 'project-1')
    .replace(/:conversationId/g, '00000000-0000-4000-8000-000000000000')
    // A real provider, so the read reaches its role check instead of stopping
    // at "unsupported provider".
    .replace(/:providerId/g, INTEGRATION_PROVIDER_IDS[0])
    .replace(/:[A-Za-z]+/g, 'x');

const call = async (method: string, path: string) => {
  const response = await harness.request(siteUrlFor(path), {
    method,
    headers: { 'content-type': 'application/json' },
    ...(WRITE_METHODS.has(method) ? { body: '{}' } : {}),
  });
  const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
  return { status: response.status, code: body.code, message: body.message };
};

describe('dashboard API permission matrix', () => {
  it('discovers the registered routes', () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(siteUrlFor('/projects/:projectId/pages/:id')).toBe('/projects/project-1/pages/x');
    expect(siteUrlFor('/projects/:id/export')).toBe('/projects/project-1/export');
  });

  it('lists only account-scoped and secret routes that exist', () => {
    const keys = new Set(routes.map(({ method, path }) => `${method} ${path}`));
    for (const key of [...Object.keys(ACCOUNT_SCOPED_WRITES), ...VIEWER_DENIED_READS]) expect(keys, key).toContain(key);
  });

  const writes = routes.filter(({ method, path }) => WRITE_METHODS.has(method) && !ACCOUNT_SCOPED_WRITES[`${method} ${path}`]);

  it.each(writes)('a Viewer cannot $method $path', async ({ method, path }) => {
    state.role = MemberRole.VIEWER;
    const result = await call(method, path);
    expect(result, `${method} ${path} must reject a Viewer at its guard`).toMatchObject({ status: 403, code: 'auth:insufficient_role' });
  });

  it.each(VIEWER_DENIED_READS.map((key) => ({ method: key.split(' ')[0] ?? 'GET', path: key.split(' ')[1] ?? '' })))(
    'a Viewer cannot read secrets at $method $path',
    async ({ method, path }) => {
      state.role = MemberRole.VIEWER;
      const result = await call(method, path);
      expect(result, `${method} ${path}`).toMatchObject({ status: 403, code: 'auth:insufficient_role' });
    },
  );

  const siteRoutes = routes.filter(({ path }) => /^\/projects\/:(?:projectId|id)(?:\/|$)/.test(path));

  it.each(siteRoutes)('someone outside the site cannot $method $path', async ({ method, path }) => {
    state.role = null;
    const result = await call(method, path);
    expect(result, `${method} ${path} must hide the site from non-members`).toMatchObject({ status: 404 });
  });

  it.each([
    MemberRole.MEMBER,
    MemberRole.ADMIN,
  ])('an Editor-level write still admits role %s past its guard', async (role) => {
    state.role = role;
    // Publishing is an Editor action: the guard lets the role through, and the
    // stubbed database then stops the handler.
    const result = await call('POST', '/projects/:projectId/deployments');
    expect(result.code).not.toBe('auth:insufficient_role');
  });
});
