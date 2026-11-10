import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./middlewares/app', () => ({ default: new Hono() }));
vi.mock('./env', () => ({ env: { NODE_ENV: 'production' } }));
vi.mock('./lib/delivery-cache', () => ({ protectPrivateDeliveryFailureResponse: (_path: string, response: Response) => response }));
vi.mock('./middlewares/observability', () => ({ observabilityMiddleware: () => async (_ctx: unknown, next: () => Promise<void>) => next() }));

describe('not found', () => {
  it('reports only the path, never the upstream origin or query', async () => {
    const { default: app } = await import('./server');
    const response = await app.request('http://server:4311/.well-known/missing?token=secret');
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toContain('/.well-known/missing');
    expect(body).not.toContain('server:4311');
    expect(body).not.toContain('token=secret');
  });
});
