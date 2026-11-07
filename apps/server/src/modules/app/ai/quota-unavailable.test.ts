import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({ get: vi.fn(), exec: vi.fn(), incr: vi.fn(), expire: vi.fn(), complete: vi.fn(), track: vi.fn() }));
vi.mock('@nibleaf/database', () => ({ prisma: { user: { findUnique: async () => ({ suspendedAt: null }) } } }));
vi.mock('@/actions/projects', () => ({
  assertProjectAccess: async () => ({ organizationId: 'site-org', role: 'member' }),
  assertProjectInOrg: async () => undefined,
}));
vi.mock('@/env', () => ({ env: { AI_DRAFT_MODEL: 'instance-model' } }));
vi.mock('@/lib/env-extras', () => ({ envExtras: { AI_DAILY_LIMIT: 50 } }));
vi.mock('@nibleaf/bullmq/keys', () => ({ keys: () => ({ REDIS_HOST: 'unused', REDIS_PORT: 6379, REDIS_DB: 0 }) }));
vi.mock('ioredis', () => ({
  Redis: class {
    get = mocks.get;
    multi() {
      return { incr: mocks.incr, expire: mocks.expire, exec: mocks.exec };
    }
    on = vi.fn();
  },
}));
vi.mock('@nibleaf/search/workspace', () => ({
  resolveWorkspaceAiConfiguration: async () => ({
    runtime: { providerId: 'openai', revision: 'site:1', answerModel: 'site-model', apiKey: 'site-secret' },
    reason: null,
  }),
  completeWorkspaceText: mocks.complete,
}));
vi.mock('@/actions/analytics', () => ({ trackProjectEvent: mocks.track }));

import handlers from './handlers';

const app = new Hono<HonoEnv>();
app.use('*', contextStorage());
app.use('*', async (c, next) => {
  c.set('user', { id: 'user', name: 'User', email: 'user@example.com' });
  await next();
});
app.onError((error, c) => (error instanceof AppError ? c.json(error.toJSON(), error.status) : c.json({ error: 'unexpected' }, 500)));
app.route('/api/app/projects/:projectId/ai', handlers);
const base = '/api/app/projects/site/ai';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockRejectedValue(new Error('Redis unavailable'));
  mocks.exec.mockRejectedValue(new Error('Redis unavailable'));
  mocks.incr.mockReturnThis();
  mocks.expire.mockReturnThis();
});
describe('drafting while Redis is unavailable', () => {
  it('returns a secret-free capability state without consuming quota', async () => {
    const response = await app.request(`${base}/draft-capability`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { available: false, source: 'workspace', provider: 'openai', reason: 'quota_unavailable' } });
    expect(mocks.get).toHaveBeenCalledOnce();
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('fails closed with 503 usage:unavailable before any provider call', async () => {
    const response = await app.request(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'outline', content: 'Synthetic guide' }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'usage:unavailable' } });
    expect(mocks.exec).toHaveBeenCalledOnce();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });
});
