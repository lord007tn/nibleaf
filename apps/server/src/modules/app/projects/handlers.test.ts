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

const appFor = (authenticated: boolean) => {
  const app = new Hono<HonoEnv>();
  app.use('*', contextStorage());
  app.use('*', async (ctx, next) => {
    ctx.set('user', authenticated ? { id: 'user', name: 'User', email: 'user@example.com' } : null);
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
