import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  role: 'member' as string,
  getOpenApiDocument: vi.fn(async () => ({ title: 'API Reference' })),
  upsertOpenApiDocument: vi.fn(async () => ({ title: 'API Reference' })),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    project: { findUnique: vi.fn(async () => ({ id: 'project', organizationId: 'org' })) },
    member: { findUnique: vi.fn(async () => ({ role: mocks.role })) },
  },
}));

vi.mock('@/actions/openapi', () => ({
  getOpenApiDocument: mocks.getOpenApiDocument,
  upsertOpenApiDocument: mocks.upsertOpenApiDocument,
  syncOpenApiDocument: vi.fn(),
  deleteOpenApiDocument: vi.fn(),
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
  app.route('/projects/:projectId/openapi', handlers);
  return app;
};

describe('OpenAPI project permissions', () => {
  beforeEach(() => {
    mocks.role = 'member';
    vi.clearAllMocks();
  });

  it('does not expose source metadata to anonymous callers', async () => {
    const response = await appFor(false).request('/projects/project/openapi');
    expect(response.status).toBe(401);
    expect(mocks.getOpenApiDocument).not.toHaveBeenCalled();
  });

  it('lets project members read metadata but not replace a specification', async () => {
    expect((await appFor(true).request('/projects/project/openapi')).status).toBe(200);
    const response = await appFor(true).request('/projects/project/openapi', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'API Reference',
        path: 'api-reference',
        source: { type: 'upload', content: '{"openapi":"3.1.0","info":{"title":"API","version":"1"},"paths":{}}' },
      }),
    });
    expect(response.status).toBe(403);
    expect(mocks.upsertOpenApiDocument).not.toHaveBeenCalled();
  });

  it('allows project admins to replace a validated specification', async () => {
    mocks.role = 'admin';
    const response = await appFor(true).request('/projects/project/openapi', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'API Reference',
        path: 'api-reference',
        source: { type: 'upload', content: '{"openapi":"3.1.0","info":{"title":"API","version":"1"},"paths":{}}' },
      }),
    });
    expect(response.status).toBe(200);
    expect(mocks.upsertOpenApiDocument).toHaveBeenCalledWith('org', 'project', expect.objectContaining({ path: 'api-reference' }));
  });
});
