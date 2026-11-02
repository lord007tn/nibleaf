import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorMiddleware } from '@/errors/handler';
import type { HonoEnv } from '@/lib/hono/context';
import { rateLimit } from './rate-limit';

describe('rate-limit retry guidance', () => {
  afterEach(() => vi.useRealTimers());

  it('reports the remaining window and permits requests after it expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
    const app = new Hono<HonoEnv>();
    app.onError(errorMiddleware({ isDevelopment: false }));
    app.use('*', rateLimit({ windowMs: 60_000, max: 1 }));
    app.get('/', (context) => context.json({ ok: true }));
    expect((await app.request('/')).status).toBe(200);
    vi.setSystemTime(new Date('2026-10-17T12:00:32.200Z'));
    const rejected = await app.request('/');
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get('retry-after')).toBe('28');
    expect(await rejected.json()).toMatchObject({ error: { code: 'http:rate_limited' } });
    vi.setSystemTime(new Date('2026-10-17T12:01:00.001Z'));
    const recovered = await app.request('/');
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get('retry-after')).toBeNull();
  });
});
