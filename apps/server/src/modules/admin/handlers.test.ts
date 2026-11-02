import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  role: 'user' as string,
  getActivationFunnel: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: { user: { findUnique: vi.fn(async () => ({ suspendedAt: null, role: mocks.role })) } },
}));
vi.mock('@/actions/admin', () => ({}));
vi.mock('@/actions/platform-events', () => ({ getActivationFunnel: mocks.getActivationFunnel }));

import handlers from './handlers';

const appFor = (authenticated: boolean) => {
  const app = new Hono<HonoEnv>();
  app.use('*', contextStorage());
  app.use('*', async (ctx, next) => {
    ctx.set('user', authenticated ? { id: 'user', name: 'User', email: 'user@example.com' } : null);
    await next();
  });
  app.onError((error, ctx) =>
    error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: { message: error.message } }, 500),
  );
  app.route('/admin', handlers);
  return app;
};

describe('admin activation funnel access', () => {
  beforeEach(() => {
    mocks.role = 'user';
    vi.clearAllMocks();
    mocks.getActivationFunnel.mockResolvedValue({ days: 30 });
  });

  it('rejects anonymous callers before computing the funnel', async () => {
    const response = await appFor(false).request('/admin/funnel');
    expect(response.status).toBe(401);
    expect(mocks.getActivationFunnel).not.toHaveBeenCalled();
  });

  it('rejects signed-in users without the admin role', async () => {
    const response = await appFor(true).request('/admin/funnel');
    expect(response.status).toBe(403);
    expect(mocks.getActivationFunnel).not.toHaveBeenCalled();
  });

  it('serves platform admins an uncacheable response', async () => {
    mocks.role = 'admin';
    const response = await appFor(true).request('/admin/funnel');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ data: { days: 30 } });
  });
});
