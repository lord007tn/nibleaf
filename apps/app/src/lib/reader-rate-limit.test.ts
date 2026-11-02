import { describe, expect, it, vi } from 'vitest';
import { ApiResponseError, getData } from '@/hooks/api/client-helpers';
import { readerRateLimitResponse } from './reader-rate-limit';

describe('reader rate-limit responses', () => {
  it('keeps upstream retry guidance through the API error and SSR response', async () => {
    const upstream = Response.json(
      { error: { code: 'http:rate_limited', message: 'Too many requests, please slow down.' } },
      { status: 429, headers: { 'retry-after': '27' } },
    );
    const error = await getData(upstream, 'page').catch((cause: unknown) => cause);
    const original = new Response('<h1>Please try again</h1>', {
      status: 500,
      headers: { 'content-type': 'text/html', 'set-cookie': 'reader=fixture' },
    });
    const response = readerRateLimitResponse(original, [error]);
    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) throw new Error('Expected an HTTP response');
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('27');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBe('reader=fixture');
    expect(await response.text()).toBe('<h1>Please try again</h1>');
  });

  it('preserves stream ownership and cleanup when correcting a rendered response', () => {
    const dispose = vi.fn();
    const original = { response: new Response('retry', { status: 500 }), serverSsrCleanup: 'stream' as const, dispose };
    const result = readerRateLimitResponse(original, [new ApiResponseError('Slow down', 429)]);
    if (result instanceof Response) throw new Error('Expected the stream lifecycle wrapper');
    expect(result.response.status).toBe(429);
    expect(result.serverSsrCleanup).toBe('stream');
    expect('dispose' in result && result.dispose).toBe(dispose);
  });

  it.each([200, 404, 503])('does not replace an existing %s response', (status) => {
    const response = new Response('existing', { status });
    expect(readerRateLimitResponse(response, [new ApiResponseError('Slow down', 429)])).toBe(response);
  });

  it.each([new Error('Unknown'), new ApiResponseError('Unavailable', 503), { status: 429 }])(
    'keeps unrelated and untrusted errors as server errors',
    (error) => {
      const response = new Response('error', { status: 500 });
      expect(readerRateLimitResponse(response, [error])).toBe(response);
    },
  );
});
