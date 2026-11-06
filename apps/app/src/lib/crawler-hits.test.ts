import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/env.server', () => ({ serverEnv: { INTERNAL_API_SECRET: 'fictional-internal-proof' } }));
vi.mock('@/services/api-origin', () => ({ apiOrigin: () => 'http://app.test' }));

import { observeCrawlerResponse } from './crawler-hits';

describe('outer published crawler observer', () => {
  const fetch = vi.fn(async () => new Response(null, { status: 202 }));
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetch);
    fetch.mockClear();
  });
  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('returns the response without waiting for project resolution, batches original UA/status', async () => {
    let resolve: (id: string) => void = () => undefined;
    const project = new Promise<string>((done) => {
      resolve = done;
    });
    const result = new Response('docs', { status: 404, headers: { 'content-type': 'text/markdown' } });
    const returned = await observeCrawlerResponse(
      new Request('http://app.test/sites/p/guide.md', { headers: { 'user-agent': 'ChatGPT-User/1' } }),
      Promise.resolve(result),
      () => project,
    );
    expect(returned).toBe(result);
    expect(fetch).not.toHaveBeenCalled();
    resolve('p');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledOnce();
    const request = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(request[1].headers).toMatchObject({ 'x-nibleaf-internal': 'fictional-internal-proof' });
    expect(JSON.parse(String(request[1].body)).hits[0]).toMatchObject({
      identifier: 'p',
      path: 'guide.md',
      userAgent: 'ChatGPT-User/1',
      statusCode: 404,
      contentType: 'text/markdown',
    });
  });
  it('ignores API proxy fetches, humans, and dashboard root machine files', async () => {
    const response = () => Promise.resolve(new Response('ok', { headers: { 'content-type': 'text/plain' } }));
    const resolve = vi.fn(async () => null);
    await observeCrawlerResponse(
      new Request('http://app.test/api/public/sites/p/markdown', { headers: { 'user-agent': 'GPTBot' } }),
      response(),
      resolve,
    );
    await observeCrawlerResponse(new Request('http://app.test/sites/p/guide', { headers: { 'user-agent': 'Mozilla/5.0' } }), response(), resolve);
    await observeCrawlerResponse(new Request('http://app.test/robots.txt', { headers: { 'user-agent': 'GPTBot' } }), response(), resolve);
    await vi.advanceTimersByTimeAsync(1000);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
