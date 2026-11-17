import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { errorMiddleware } from '@/errors/handler';
import { DEFAULT_REQUEST_BODY_BYTES, MAX_PAGE_REQUEST_BYTES, requestBodyLimit } from './body-limit';

const MiB = 1024 * 1024;

const harness = () => {
  const parsed = vi.fn();
  const read = async (ctx: { req: { text: () => Promise<string> } }) => {
    const text = await ctx.req.text();
    parsed(text.length);
    return text.length;
  };
  const app = new Hono()
    .use('*', requestBodyLimit())
    .post('/api/app/projects/:projectId/pages', async (ctx) => ctx.json({ length: await read(ctx) }))
    .patch('/api/app/projects/:projectId/pages/:id', async (ctx) => ctx.json({ length: await read(ctx) }))
    .post('/api/app/projects/:projectId/comments', async (ctx) => ctx.json({ length: await read(ctx) }))
    .put('/api/app/projects/:projectId/openapi', async (ctx) => ctx.json({ length: await read(ctx) }))
    .post('/api/public/git/webhook/:projectId', async (ctx) => ctx.json({ length: await read(ctx) }))
    // Stands in for the route's own limit: the global one must not apply here.
    .put('/api/app/projects/:projectId/assets/upload/:token', (ctx) => ctx.json({ reached: true }))
    .onError(errorMiddleware({ isDevelopment: false }));
  return { app, parsed };
};

/** A body with no Content-Length, streamed in 64 KiB chunks; counts what was pulled. */
const streamed = (totalBytes: number) => {
  const pulled = { bytes: 0 };
  const chunk = new Uint8Array(64 * 1024).fill(0x61);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled.bytes >= totalBytes) return controller.close();
      pulled.bytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  return { body, pulled };
};

const send = (app: Hono, method: string, path: string, body: string | ReadableStream<Uint8Array>) =>
  app.request(path, { method, body, ...(typeof body === 'string' ? {} : { duplex: 'half' }) } as RequestInit);

describe('request body limit', () => {
  it('refuses a declared oversized page save before reading or parsing it', async () => {
    const { app, parsed } = harness();
    const response = await app.request('/api/app/projects/p/pages/page-1', {
      method: 'PATCH',
      headers: { 'content-length': String(MAX_PAGE_REQUEST_BYTES + 1) },
      body: 'x',
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: 'page:too_large', details: { limit: 2 * MiB, requestLimit: MAX_PAGE_REQUEST_BYTES } },
    });
    expect(parsed).not.toHaveBeenCalled();
  });

  it('stops reading an undeclared page body as soon as it passes the limit', async () => {
    const { app, parsed } = harness();
    const { body, pulled } = streamed(100 * MiB);
    const response = await send(app, 'POST', '/api/app/projects/p/pages', body);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'page:too_large' } });
    expect(parsed).not.toHaveBeenCalled();
    // Read stopped just past the 16 MiB limit, far short of 100 MiB.
    expect(pulled.bytes).toBeLessThan(MAX_PAGE_REQUEST_BYTES + 2 * MiB);
  });

  it('lets a 2.5 MiB save of a page stored over the cap through, even fully JSON-escaped', async () => {
    const { app } = harness();
    const plain = JSON.stringify({ content: 'x'.repeat(2.5 * MiB) });
    const escaped = JSON.stringify({ content: '\u0001'.repeat(2.5 * MiB) });
    expect(escaped.length).toBeGreaterThan(6 * 2.5 * MiB);
    expect(escaped.length).toBeLessThan(MAX_PAGE_REQUEST_BYTES);
    for (const body of [plain, escaped]) {
      const response = await send(app, 'PATCH', '/api/app/projects/p/pages/page-1', body);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ length: body.length });
    }
  });

  it('applies the default to every other write, with a generic 413', async () => {
    const { app, parsed } = harness();
    expect((await send(app, 'POST', '/api/app/projects/p/comments', 'x'.repeat(DEFAULT_REQUEST_BODY_BYTES))).status).toBe(200);
    const response = await send(app, 'POST', '/api/app/projects/p/comments', 'x'.repeat(DEFAULT_REQUEST_BODY_BYTES + 1));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'http:payload_too_large', details: { limit: DEFAULT_REQUEST_BODY_BYTES } } });
    expect(parsed).toHaveBeenCalledOnce();
  });

  it('raises the limit only where a route needs it', async () => {
    const { app } = harness();
    expect((await send(app, 'PUT', '/api/app/projects/p/openapi', 'x'.repeat(10 * MiB))).status).toBe(200);
    expect((await send(app, 'POST', '/api/public/git/webhook/p', 'x'.repeat(20 * MiB))).status).toBe(200);
    expect((await send(app, 'POST', '/api/public/git/webhook/p', 'x'.repeat(25 * MiB + 1))).status).toBe(413);
    // A route with its own limit is left to it.
    const upload = await app.request('/api/app/projects/p/assets/upload/t', {
      method: 'PUT',
      headers: { 'content-length': String(40 * MiB) },
      body: 'x',
    });
    expect(await upload.json()).toEqual({ reached: true });
  });
});
