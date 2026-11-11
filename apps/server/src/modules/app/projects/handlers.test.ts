import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  member: { role: 'member' } as { role: string } | null,
  exportProjectThemeRepository: vi.fn(async () => ({ fileName: 'theme.zip', data: new Uint8Array([80, 75]) })),
  getProjectThemeCatalog: vi.fn(async () => ({ schemaVersion: 1, authoring: [] })),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    project: { findUnique: vi.fn(async () => ({ id: 'project', organizationId: 'org' })) },
    member: { findUnique: vi.fn(async () => mocks.member) },
  },
}));

vi.mock('@/actions/export', () => ({
  exportProjectMarkdown: vi.fn(),
  exportProjectThemeRepository: mocks.exportProjectThemeRepository,
}));

vi.mock('@/actions/projects', () => ({
  assertProjectAccess: vi.fn(async () => {
    if (!mocks.member) {
      const { AppError } = await import('@/errors');
      throw new AppError({ code: 'database:not_found', entityType: 'project', message: 'project not found' });
    }
    return { project: { id: 'project', organizationId: 'org' }, organizationId: 'org', role: mocks.member.role };
  }),
  checkProjectAvailability: vi.fn(async () => ({ slug: 'docs', available: true, suggestedSlug: 'docs', nameTaken: false })),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  getProject: vi.fn(),
  listProjects: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock('@/actions/themes', () => ({
  exportProjectTheme: vi.fn(),
  getProjectThemeCatalog: mocks.getProjectThemeCatalog,
  importProjectTheme: vi.fn(),
}));

import handlers from './handlers';

const appFor = (authenticated: boolean, userId = 'user') => {
  const app = new Hono<HonoEnv>();
  app.use('*', contextStorage());
  app.use('*', async (ctx, next) => {
    ctx.set('user', authenticated ? { id: ctx.req.header('x-test-user') ?? userId, name: 'User', email: 'user@example.com' } : null);
    ctx.set('organizationId', null);
    ctx.set('membership', null);
    await next();
  });
  app.onError((error, ctx) =>
    error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: { message: error.message } }, 500),
  );
  app.route('/projects', handlers);
  return app;
};

describe('theme repository export permissions', () => {
  beforeEach(() => {
    mocks.member = { role: 'member' };
    vi.clearAllMocks();
  });

  it('rejects anonymous callers before generating an archive', async () => {
    const response = await appFor(false).request('/projects/project/theme-repository');
    expect(response.status).toBe(401);
    expect(mocks.exportProjectThemeRepository).not.toHaveBeenCalled();
  });

  it('does not reveal the project or archive to authenticated non-members', async () => {
    mocks.member = null;
    const response = await appFor(true).request('/projects/project/theme-repository');
    expect(response.status).toBe(404);
    expect(mocks.exportProjectThemeRepository).not.toHaveBeenCalled();
  });

  it('lets project members download the runnable archive', async () => {
    const response = await appFor(true).request('/projects/project/theme-repository');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(mocks.exportProjectThemeRepository).toHaveBeenCalledWith('project');
  });

  it('derives tenant authority before returning the sanitized theme catalog', async () => {
    const response = await appFor(true).request('/projects/project/theme-catalog');

    expect(response.status).toBe(200);
    expect(mocks.getProjectThemeCatalog).toHaveBeenCalledWith('org', 'project');
  });

  it('does not disclose the theme catalog to authenticated non-members', async () => {
    mocks.member = null;
    const response = await appFor(true).request('/projects/project/theme-catalog');

    expect(response.status).toBe(404);
    expect(mocks.getProjectThemeCatalog).not.toHaveBeenCalled();
  });
});

describe('project availability endpoint', () => {
  it('requires authentication', async () => {
    expect((await appFor(false).request('/projects/availability?name=Docs')).status).toBe(401);
  });
  it('checks availability before the dynamic project-id route', async () => {
    const response = await appFor(true).request('/projects/availability?name=Docs');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { slug: 'docs', available: true, suggestedSlug: 'docs', nameTaken: false } });
  });
  it('rejects invalid typed slugs and missing names', async () => {
    expect((await appFor(true).request('/projects/availability?name=Docs&slug=Bad')).status).toBe(422);
    expect((await appFor(true).request('/projects/availability')).status).toBe(422);
  });
});


describe('availability rate limits', () => {
  it('limits one authenticated user across distinct client IPs', async () => {
    const app = appFor(true, 'rate-user');
    const responses = [];
    for (let i = 0; i < 21; i++) responses.push(await app.request('/projects/availability?name=Site', { headers: { 'x-forwarded-for': `8.8.4.${i + 1}` } }));
    expect(responses.slice(0, 20).every((response) => response.status === 200)).toBe(true);
    expect(responses[20]?.status).toBe(429);
    expect(responses[20]?.headers.get('retry-after')).toBeTruthy();
  });
  it('limits one IP even when the authenticated user changes', async () => {
    const app = appFor(true);
    const responses = [];
    for (let i = 0; i < 31; i++) responses.push(await app.request('/projects/availability?name=Site', { headers: { 'x-forwarded-for': '1.1.1.1', 'x-test-user': `ip-user-${i}` } }));
    expect(responses.slice(0, 30).every((response) => response.status === 200)).toBe(true);
    expect(responses[30]?.status).toBe(429);
  });
});
