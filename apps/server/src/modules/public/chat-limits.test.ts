import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorMiddleware } from '@/errors/handler';
import type { HonoEnv } from '@/lib/hono/context';

describe('anonymous conversation admission', () => {
  afterEach(() => vi.resetModules());

  it('applies the per-IP chat limit before admitting fresh conversation ids', async () => {
    const admitted = vi.fn();
    vi.doMock('@/lib/env-extras', () => ({ envExtras: { RATE_LIMIT_PUBLIC_PER_MIN: 100, SEARCH_ANSWER_RATE_LIMIT_PER_MIN: 2 } }));
    vi.doMock('@/actions/site-chat', () => ({ recordChatRateLimited: vi.fn() }));
    vi.doMock('./sites/handlers', () => ({
      default: new Hono().post('/:id/chat', async (ctx) => {
        admitted(await ctx.req.json());
        return ctx.json({ ok: true });
      }),
    }));
    for (const name of ['assets', 'domains', 'git', 'invitations', 'join', 'marketing-events', 'meta', 'reader-access']) {
      vi.doMock(`./${name}/handlers`, () => ({ default: new Hono() }));
    }
    const routes = (await import('./index')).default;
    const app = new Hono<HonoEnv>().onError(errorMiddleware({ isDevelopment: false })).route('/api/public', routes);
    const start = () =>
      app.request('/api/public/sites/docs/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.12' },
        body: JSON.stringify({ conversationId: randomUUID(), question: 'How do I install?', history: [] }),
      });
    expect((await start()).status).toBe(200);
    expect((await start()).status).toBe(200);
    expect((await start()).status).toBe(429);
    expect(admitted).toHaveBeenCalledTimes(2);
    expect(admitted.mock.calls[0]?.[0].conversationId).not.toBe(admitted.mock.calls[1]?.[0].conversationId);
  });
});
