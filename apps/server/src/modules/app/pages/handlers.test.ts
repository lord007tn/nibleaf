import { buildSnapshot } from '@nibleaf/shared/site';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, notFound } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

/** Who can reach which site, and in which organization each site lives. */
const access = vi.hoisted(() => ({
  roles: new Map<string, string>([
    ['viewer:site-a', 'viewer'],
    ['viewer:site-b', 'viewer'],
  ]),
  organizations: new Map([
    ['site-a', 'org-a'],
    ['site-b', 'org-b'],
  ]),
}));
const database = vi.hoisted(() => ({
  pageFindFirst: vi.fn(),
  pageFindMany: vi.fn(),
  projectFindUnique: vi.fn(),
  revision: vi.fn(),
  transaction: vi.fn(),
}));
const history = vi.hoisted(() => ({ listPageHistory: vi.fn(), comparePageHistory: vi.fn(), restorePageHistory: vi.fn() }));
vi.mock('@/actions/page-history', () => history);
vi.mock('@/lib/site-host', () => ({ trustedSiteOrigins: () => [] }));

vi.mock('@nibleaf/database', () => ({
  Prisma: { JsonNull: null },
  prisma: {
    page: { findFirst: database.pageFindFirst, findMany: database.pageFindMany },
    project: { findUnique: database.projectFindUnique },
    $queryRaw: database.revision,
    $transaction: database.transaction,
  },
}));
// The real guards run; only the membership lookup they rely on is a fixture.
vi.mock('@/lib/access', () => {
  const resolveSiteAccess = async (userId: string, projectId: string) => {
    const role = access.roles.get(`${userId}:${projectId}`);
    if (!role) throw notFound('project', { id: projectId });
    return { project: { id: projectId }, organizationId: access.organizations.get(projectId), role };
  };
  return { resolveSiteAccess, assertUsableAccount: async () => undefined, accessibleProjectIds: async () => [], resolveOrgAccess: vi.fn() };
});
vi.mock('@/actions/projects', async () => {
  const { resolveSiteAccess } = await import('@/lib/access');
  return {
    assertProjectAccess: resolveSiteAccess,
    assertProjectInOrg: async (organizationId: string, projectId: string) => {
      if (access.organizations.get(projectId) !== organizationId) throw notFound('project', { id: projectId });
      return { id: projectId };
    },
  };
});
vi.mock('@/lib/page-address-changes', () => ({}));
vi.mock('@/actions/platform-events', () => ({}));
vi.mock('@/actions/branches', () => ({}));
vi.mock('@/actions/languages', () => ({}));

import handlers from './handlers';

const REVISION = new Date('2026-11-10T08:00:00.000Z');
/** One page, on site-a. */
const PAGE = { id: 'page-a', projectId: 'site-a', content: 'Install the CLI and sign in.', updatedAt: REVISION };

const app = new Hono<HonoEnv>()
  .use('*', contextStorage())
  .use('*', async (ctx, next) => {
    const user = ctx.req.header('x-test-user');
    ctx.set('user', user ? ({ id: user } as never) : null);
    await next();
  })
  .route('/api/app/projects/:projectId/pages', handlers)
  .onError((error, ctx) => (error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: String(error) }, 500)));

const read = (projectId: string, pageId: string, user: string | null = 'viewer') =>
  app.request(`/api/app/projects/${projectId}/pages/${pageId}/search-description`, { headers: user ? { 'x-test-user': user } : {} });

beforeEach(() => {
  const snapshot = buildSnapshot(
    {
      id: 'site-a',
      name: 'Docs',
      slug: 'docs',
      description: null,
      icon: null,
      config: null,
      languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null }],
      branches: [
        { id: 'main', name: 'main', isDefault: true },
        { id: 'other', name: 'other', isDefault: false },
      ],
    },
    [
      { id: 'page-a', path: 'guide', content: 'Guide', branchId: 'main' },
      { id: 'source', path: 'source', content: '[guide](/guide)', branchId: 'main' },
      { id: 'other-source', path: 'other-source', content: '[guide](/guide)', branchId: 'other' },
    ].map((row) => ({
      ...row,
      parentId: null,
      languageCode: 'en',
      kind: 'PAGE' as const,
      title: row.id,
      slug: row.path,
      icon: null,
      description: null,
      config: null,
      translationKey: null,
      position: 0,
      hidden: false,
      updatedAt: REVISION.toISOString(),
    })),
    REVISION.toISOString(),
  );
  history.listPageHistory.mockReset().mockResolvedValue({ entries: [], next: null });
  history.comparePageHistory.mockReset().mockResolvedValue({ expectedUpdatedAt: REVISION.toISOString(), diff: { status: 'equal', lines: [] } });
  history.restorePageHistory.mockReset();
  database.pageFindFirst
    .mockReset()
    .mockImplementation(async ({ where, select }: { where: { id: string; projectId: string }; select: Record<string, true> }) => {
      if (where.id !== PAGE.id || where.projectId !== PAGE.projectId) return null;
      if (select.branchId) return { branchId: 'main' };
      return select.content ? { content: PAGE.content, updatedAt: PAGE.updatedAt } : { updatedAt: PAGE.updatedAt };
    });
  database.projectFindUnique
    .mockReset()
    .mockResolvedValue({ ...snapshot.project, branches: snapshot.project.versions, domains: [], openApiDocument: null, updatedAt: REVISION });
  database.pageFindMany.mockReset().mockResolvedValue(
    snapshot.pages
      .filter((p: { versionId: string }) => p.versionId === 'main')
      .map((p: { languageCode: string }) => ({
        ...p,
        branchId: 'main',
        language: { code: p.languageCode },
        createdAt: REVISION,
        updatedAt: REVISION,
      })),
  );
  database.revision.mockReset().mockResolvedValue([{ revision: 'fixture-revision', count: 2 }]);
});

describe('GET /pages/:id/inbound-links through the real routes and guards', () => {
  const request = (projectId = 'site-a', pageId = 'page-a', user: string | null = 'viewer') =>
    app.request(`/api/app/projects/${projectId}/pages/${pageId}/inbound-links`, { headers: user ? { 'x-test-user': user } : {} });
  it('allows a site viewer and scopes sources to the target branch', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { total: 1, pages: [{ id: 'source', title: 'source', path: 'source' }] } });
    expect(database.pageFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: 'site-a', branchId: 'main' } }));
  });
  it('passes request cancellation to the advisory before reading page bodies', async () => {
    await app.request('/api/app/projects/site-a/pages/page-a/inbound-links', {
      headers: { 'x-test-user': 'viewer' },
      signal: AbortSignal.abort(),
    });
    expect(database.pageFindFirst).not.toHaveBeenCalled();
    expect(database.pageFindMany).not.toHaveBeenCalled();
  });
  it('returns 404 to outsiders and 401 without a session before reading any snapshot', async () => {
    expect((await request('site-a', 'page-a', 'outsider')).status).toBe(404);
    expect((await request('site-a', 'page-a', null)).status).toBe(401);
    expect(database.pageFindFirst).not.toHaveBeenCalled();
  });
  it('returns 404 for a missing page or a page belonging to another site the viewer can also read', async () => {
    expect((await request('site-a', 'missing')).status).toBe(404);
    expect((await request('site-b', 'page-a')).status).toBe(404);
    expect(database.pageFindFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { projectId: 'site-b', id: 'page-a' } }));
  });
});

describe('page history route authorization', () => {
  const request = (action: 'list' | 'compare' | 'restore', user: string) =>
    app.request(
      `/api/app/projects/site-a/pages/page-a/history${action === 'list' ? '' : action === 'compare' ? '/compare?source=revision&entryId=revision-a' : '/restore'}`,
      {
        method: action === 'restore' ? 'POST' : 'GET',
        headers: { 'x-test-user': user, 'content-type': 'application/json' },
        ...(action === 'restore'
          ? { body: JSON.stringify({ source: 'revision', entryId: 'revision-a', expectedUpdatedAt: REVISION.toISOString() }) }
          : {}),
      },
    );
  it('allows a viewer to list and compare, but rejects restore before any write', async () => {
    expect((await request('list', 'viewer')).status).toBe(200);
    expect((await request('compare', 'viewer')).status).toBe(200);
    expect(history.listPageHistory).toHaveBeenCalledOnce();
    expect(history.comparePageHistory).toHaveBeenCalledOnce();
    expect((await request('restore', 'viewer')).status).toBe(403);
    expect(history.restorePageHistory).not.toHaveBeenCalled();
  });
  it('returns 404 to an outsider for all three endpoints before reading history', async () => {
    for (const action of ['list', 'compare', 'restore'] as const) expect((await request(action, 'outsider')).status).toBe(404);
    expect(history.listPageHistory).not.toHaveBeenCalled();
    expect(history.comparePageHistory).not.toHaveBeenCalled();
    expect(history.restorePageHistory).not.toHaveBeenCalled();
  });
});

describe('GET /pages/:id/search-description', () => {
  it('serves a Viewer the generated description and the revision it came from', async () => {
    const response = await read('site-a', 'page-a');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { description: 'Install the CLI and sign in.', revision: REVISION.toISOString() } });
  });

  it('serves the full generated text, not the search-length cut: the editor cuts the preview and "Write your own" starts from it', async () => {
    const long = `Nibleaf ${'docs go up in a day so you can '.repeat(8)}`.trim();
    // Another project revision, so the cached description of the short body isn't served.
    database.projectFindUnique.mockResolvedValue({ config: null, updatedAt: new Date('2026-11-10T09:00:00.000Z') });
    database.pageFindFirst.mockImplementation(async ({ select }: { select: Record<string, true> }) =>
      select.content ? { content: long, updatedAt: PAGE.updatedAt } : { updatedAt: PAGE.updatedAt },
    );
    const { data } = (await (await read('site-a', 'page-a')).json()) as { data: { description: string } };
    expect(data.description).toBe(long);
    expect(data.description.length).toBeGreaterThan(155);
    expect(data.description.endsWith('…')).toBe(false);
  });

  it('answers 401 without a session and 404 to someone without access to the site, before reading the page', async () => {
    expect((await read('site-a', 'page-a', null)).status).toBe(401);
    expect((await read('site-a', 'page-a', 'outsider')).status).toBe(404);
    expect(database.pageFindFirst).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing page', async () => {
    expect((await read('site-a', 'no-such-page')).status).toBe(404);
  });

  it("answers 404 for another site's page id, even to someone who can reach both sites", async () => {
    const response = await read('site-b', 'page-a');
    expect(response.status).toBe(404);
    expect(database.pageFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'page-a', projectId: 'site-b' } }));
  });

  // Last: the limiter is per process and counts every request made in this file.
  it('is rate limited', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 61; attempt += 1) statuses.push((await read('site-a', 'page-a')).status);
    expect(statuses[0]).toBe(200);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe('POST /pages/:id/duplicate', () => {
  const duplicate = (projectId: string, user: string | null) =>
    app.request(`/api/app/projects/${projectId}/pages/page-a/duplicate`, { method: 'POST', headers: user ? { 'x-test-user': user } : {} });

  it('turns a Viewer away with 403, an outsider with 404 and no session with 401, before any write', async () => {
    expect((await duplicate('site-a', 'viewer')).status).toBe(403);
    expect((await duplicate('site-a', 'outsider')).status).toBe(404);
    expect((await duplicate('site-a', null)).status).toBe(401);
    expect(database.transaction).not.toHaveBeenCalled();
  });
});
