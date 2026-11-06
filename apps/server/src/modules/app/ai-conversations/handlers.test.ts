import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({ role: 'member' as string | null, list: vi.fn(), remove: vi.fn() }));
vi.mock('@nibleaf/database', () => ({
  prisma: {
    user: { findUnique: async () => ({ suspendedAt: null }) },
    project: { findUnique: async () => ({ id: 'project', organizationId: 'org' }) },
    member: { findUnique: async () => (mocks.role ? { role: mocks.role } : null) },
  },
}));
vi.mock('@/actions/projects', () => ({
  assertProjectAccess: async () => {
    if (!mocks.role) throw new AppError({ code: 'database:not_found' });
    return { project: { id: 'project', organizationId: 'org' }, organizationId: 'org', role: mocks.role };
  },
}));
vi.mock('@/actions/ai-conversations', () => ({
  listProjectAiConversations: mocks.list,
  deleteProjectAiConversation: mocks.remove,
  getProjectAiConversation: vi.fn(),
  getProjectAiConversationSummary: vi.fn(),
  listProjectAiContentGaps: vi.fn(),
}));

import handlers from './handlers';

const appFor = (auth = true) => {
  const app = new Hono<HonoEnv>();
  app.use('*', contextStorage());
  app.use('*', async (c, next) => {
    c.set('user', auth ? { id: 'user', name: 'User', email: 'user@example.com' } : null);
    c.set('organizationId', null);
    c.set('membership', null);
    await next();
  });
  app.onError((e, c) => (e instanceof AppError ? c.json(e.toJSON(), e.status) : c.json({ error: 'failed' }, 500)));
  app.route('/projects/:projectId/ai-conversations', handlers);
  return app;
};
const base = '/projects/project/ai-conversations';
const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'member';
  mocks.list.mockResolvedValue({ items: [] });
  mocks.remove.mockResolvedValue({ deleted: true });
});
describe('archive permissions', () => {
  it('rejects anonymous and nonmembers', async () => {
    expect((await appFor(false).request(base)).status).toBe(401);
    mocks.role = null;
    expect((await appFor().request(base)).status).toBe(404);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('allows member reads and prevents caching', async () => {
    const res = await appFor().request(base);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.list).toHaveBeenCalledWith('org', 'project', expect.objectContaining({ range: '30d', limit: 25 }));
  });
  it('requires admin for deletion', async () => {
    expect((await appFor().request(`${base}/${id}`, { method: 'DELETE' })).status).toBe(403);
    expect(mocks.remove).not.toHaveBeenCalled();
    mocks.role = 'admin';
    expect((await appFor().request(`${base}/${id}`, { method: 'DELETE' })).status).toBe(200);
  });
  it('rejects invalid query filters', async () => {
    expect((await appFor().request(`${base}?limit=101`)).status).toBe(422);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
