import { Hono } from 'hono';
import { expect, it } from 'vitest';
import { AppError } from '@/errors';
import { limitImport } from './limit';

it('excludes concurrent imports by project, bounds GitBook slots, and releases failures', async () => {
  let entered = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const app = new Hono().onError((error, ctx) => (error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({}, 500)));
  app.post('/:projectId/gitbook', limitImport('gitbook'), async () => {
    entered++;
    await gate;
    throw new Error('Synthetic failure');
  });
  app.post('/:projectId/ghost', limitImport('ghost'), (ctx) => ctx.json({ done: true }));
  const first = app.request('/one/gitbook', { method: 'POST' });
  const second = app.request('/two/gitbook', { method: 'POST' });
  try {
    while (entered < 2) await new Promise((resolve) => setTimeout(resolve, 1));
    expect((await app.request('/one/ghost', { method: 'POST' })).status).toBe(409);
    const busy = await app.request('/three/gitbook', { method: 'POST' });
    expect(busy.status).toBe(503);
    expect(busy.headers.get('retry-after')).toBe('10');
  } finally {
    release();
    await Promise.all([first, second]);
  }
  expect((await app.request('/one/ghost', { method: 'POST' })).status).toBe(200);
  expect((await app.request('/three/gitbook', { method: 'POST' })).status).toBe(500);
  expect((await app.request('/three/ghost', { method: 'POST' })).status).toBe(200);
});

it('releases the slot when a disconnected request is observed by the action', async () => {
  const app = new Hono().onError((_err, ctx) => ctx.json({}, 500));
  app.post('/:projectId/gitbook', limitImport('gitbook'), async (ctx) => {
    ctx.req.raw.signal.throwIfAborted();
    return ctx.json({ done: true });
  });
  const controller = new AbortController();
  controller.abort();
  expect((await app.request(new Request('http://localhost/aborted/gitbook', { method: 'POST', signal: controller.signal }))).status).toBe(500);
  expect((await app.request('/aborted/gitbook', { method: 'POST' })).status).toBe(200);
});
