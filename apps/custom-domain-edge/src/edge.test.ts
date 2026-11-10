import { describe, expect, it } from 'vitest';
import { assetCacheKey, type EdgeCache, type EdgeDeps, edgeCacheMode, handle, isOriginFailure, isStorableAsset, originTimeoutMs } from './index';
import { maintenanceLanguage, wantsHtml } from './maintenance';

const env = { APP_ORIGIN: 'https://nibleaf.com', EDGE_SECRET: 'server-only-secret' };

class MemoryCache implements EdgeCache {
  readonly entries = new Map<string, Response>();
  async match(request: Request) {
    return this.entries.get(request.url)?.clone();
  }
  async put(request: Request, response: Response) {
    this.entries.set(request.url, new Response(await response.arrayBuffer(), response));
  }
}

const deps = (origin: (request: Request) => Promise<Response>, cache: EdgeCache | null = null) => {
  const pending: Promise<unknown>[] = [];
  const seen: Request[] = [];
  const value: EdgeDeps = {
    fetch: (request) => {
      seen.push(request);
      return origin(request);
    },
    cache,
    waitUntil: (promise) => {
      pending.push(promise);
    },
  };
  return { deps: value, seen, settle: () => Promise.all(pending) };
};

const page = (accept = 'text/html,application/xhtml+xml') => new Request('https://docs.customer.com/guides/start', { headers: { accept } });

describe('origin failure detection', () => {
  it('treats the proxy chain reporting a missing origin as a failure', () => {
    expect(isOriginFailure(new Response('no available server', { status: 503, headers: { 'content-type': 'text/plain' } }))).toBe(true);
    expect(isOriginFailure(new Response('', { status: 502 }))).toBe(true);
    expect(isOriginFailure(new Response('error code: 522', { status: 522 }))).toBe(true);
  });

  it('passes deliberate Nibleaf answers through, whatever their status', () => {
    expect(isOriginFailure(new Response('<html>', { status: 503, headers: { 'x-nibleaf-revision': 'abc' } }))).toBe(false);
    expect(isOriginFailure(new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }))).toBe(false);
    expect(isOriginFailure(new Response('not found', { status: 404 }))).toBe(false);
    expect(isOriginFailure(new Response('boom', { status: 500 }))).toBe(false);
  });
});

describe('maintenance responses', () => {
  it('replaces the raw proxy 503 with a branded, uncacheable, unindexed page', async () => {
    const { deps: d } = deps(async () => new Response('no available server', { status: 503, headers: { 'content-type': 'text/plain' } }));
    const response = await handle(page(), env, d);
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('30');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await response.text();
    expect(html).toContain('docs.customer.com');
    expect(html).toContain('temporarily unavailable');
    expect(html).not.toContain('no available server');
    expect(html).not.toMatch(/<script/i);
  });

  it('serves the page when the origin is unreachable or the Worker is misconfigured', async () => {
    const { deps: d } = deps(async () => {
      throw new TypeError('connect failed');
    });
    const response = await handle(page(), env, d);
    expect(response.status).toBe(503);
    expect(response.headers.get('x-nibleaf-edge')).toBe('unavailable; reason=network');
    const misconfigured = await handle(page(), { ...env, EDGE_SECRET: '' }, d);
    expect(misconfigured.status).toBe(503);
    expect(misconfigured.headers.get('x-nibleaf-edge')).toBe('unavailable; reason=config');
  });

  it('times out a hanging origin read and answers with the page', async () => {
    const { deps: d } = deps(
      (request) =>
        new Promise((_, reject) => {
          request.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const response = await handle(page(), { ...env, ORIGIN_TIMEOUT_MS: '1000' }, d);
    expect(response.status).toBe(503);
    expect(response.headers.get('x-nibleaf-edge')).toBe('unavailable; reason=timeout');
  });

  it('never bounds writes, which may upload or stream for longer', async () => {
    const { deps: d, seen } = deps(async () => new Response('ok'));
    await handle(new Request('https://docs.customer.com/api/public/sites/x/events', { method: 'POST', body: '{}' }), env, d);
    expect(seen[0]?.signal.aborted).toBe(false);
  });

  it('answers API and asset callers with JSON instead of HTML', async () => {
    const { deps: d } = deps(async () => new Response('no available server', { status: 503 }));
    const api = await handle(new Request('https://docs.customer.com/api/public/sites/x/search?q=a', { headers: { accept: '*/*' } }), env, d);
    expect(api.headers.get('content-type')).toContain('application/json');
    const navigationToApi = await handle(new Request('https://docs.customer.com/api/x', { headers: { accept: 'text/html' } }), env, d);
    expect(navigationToApi.headers.get('content-type')).toContain('application/json');
    expect(await api.json()).toEqual({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Temporarily unavailable. Please retry shortly.' } });
  });

  it('localises to Arabic from ?lang or the browser language, English otherwise', async () => {
    expect(maintenanceLanguage(new Request('https://d.example/?lang=ar'))).toBe('ar');
    expect(maintenanceLanguage(new Request('https://d.example/?lang=en', { headers: { 'accept-language': 'ar' } }))).toBe('en');
    expect(maintenanceLanguage(new Request('https://d.example/', { headers: { 'accept-language': 'ar-SA,ar;q=0.9,en;q=0.8' } }))).toBe('ar');
    expect(maintenanceLanguage(new Request('https://d.example/', { headers: { 'accept-language': 'en-US,ar;q=0.5' } }))).toBe('en');
    const { deps: d } = deps(async () => new Response('', { status: 502 }));
    const html = await (await handle(new Request('https://d.example/x?lang=ar', { headers: { accept: 'text/html' } }), env, d)).text();
    expect(html).toContain('lang="ar" dir="rtl"');
  });

  it('gives the HTML page only to page navigations', () => {
    expect(wantsHtml(new Request('https://d.example/', { headers: { 'sec-fetch-dest': 'document' } }))).toBe(true);
    expect(wantsHtml(new Request('https://d.example/', { method: 'POST', headers: { accept: 'text/html' } }))).toBe(false);
  });

  it('keeps HEAD bodiless', async () => {
    const { deps: d } = deps(async () => new Response('', { status: 503 }));
    const response = await handle(new Request('https://d.example/', { method: 'HEAD', headers: { accept: 'text/html' } }), env, d);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('');
  });
});

describe('forwarding headers', () => {
  it('stamps authoritative host and scheme, overriding client values', async () => {
    const { deps: d, seen } = deps(async () => new Response('ok', { headers: { 'x-nibleaf-revision': 'r' } }));
    await handle(new Request('https://docs.customer.com/', { headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'victim.test' } }), env, d);
    expect(seen[0]?.headers.get('x-forwarded-proto')).toBe('https');
    expect(seen[0]?.headers.get('x-forwarded-host')).toBe('docs.customer.com');
  });
});

describe('immutable build-asset cache', () => {
  const asset = (body = 'console.log(1)', headers: Record<string, string> = {}) =>
    new Response(body, {
      headers: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=31536000, immutable', 'x-nibleaf-revision': 'r', ...headers },
    });

  it('is off unless the mode is set explicitly', () => {
    expect(edgeCacheMode({})).toBe('off');
    expect(edgeCacheMode({ EDGE_CACHE_MODE: 'ON' })).toBe('on');
    expect(edgeCacheMode({ EDGE_CACHE_MODE: 'stale-only' })).toBe('stale-only');
    expect(edgeCacheMode({ EDGE_CACHE_MODE: 'yes' })).toBe('off');
  });

  it('does not touch the cache in off mode', async () => {
    const cache = new MemoryCache();
    const { deps: d, settle } = deps(async () => asset(), cache);
    await handle(new Request('https://a.example/assets/main-abc123.js'), env, d);
    await settle();
    expect(cache.entries.size).toBe(0);
  });

  it('shares one entry per hashed path across hostnames and serves it without the origin', async () => {
    const cache = new MemoryCache();
    let calls = 0;
    const { deps: d, settle } = deps(async () => {
      calls += 1;
      return asset();
    }, cache);
    const on = { ...env, EDGE_CACHE_MODE: 'on' };
    const first = await handle(new Request('https://a.example/assets/main-abc123.js'), on, d);
    expect(first.headers.get('x-nibleaf-edge')).toBe('miss');
    expect(await first.text()).toBe('console.log(1)');
    await settle();
    expect([...cache.entries.keys()]).toEqual(['https://nibleaf.com/__nibleaf_edge/v1/app-assets/assets/main-abc123.js']);
    const second = await handle(new Request('https://b.example/assets/main-abc123.js'), on, d);
    expect(second.headers.get('x-nibleaf-edge')).toBe('hit');
    expect(await second.text()).toBe('console.log(1)');
    expect(calls).toBe(1);
  });

  it('serves a cached asset while the origin is down', async () => {
    const cache = new MemoryCache();
    const on = { ...env, EDGE_CACHE_MODE: 'stale-only' };
    const warm = deps(async () => asset(), cache);
    await handle(new Request('https://a.example/assets/chunk-1.js'), on, warm.deps);
    await warm.settle();
    const down = deps(async () => new Response('no available server', { status: 503 }), cache);
    const response = await handle(new Request('https://a.example/assets/chunk-1.js'), on, down.deps);
    expect(response.status).toBe(200);
  });

  it.each([
    ['/assets/x.js?v=1', 'query strings'],
    ['/assets/../secret', 'traversal'],
    ['/assets/nested/x.js', 'nested paths'],
    ['/guides/assets/x.js', 'non-root asset paths'],
  ])('never keys %s (%s)', (path) => {
    expect(assetCacheKey(new Request(`https://a.example${path}`), env)).toBeNull();
  });

  it('never keys writes', () => {
    expect(assetCacheKey(new Request('https://a.example/assets/x.js', { method: 'POST' }), env)).toBeNull();
  });

  it.each([
    ['a non-immutable response', asset('x', { 'cache-control': 'public, max-age=60' })],
    ['a private response', asset('x', { 'cache-control': 'private, immutable' })],
    ['an HTML fallback', asset('<html>', { 'content-type': 'text/html' })],
    ['a response setting a cookie', asset('x', { 'set-cookie': 'a=b' })],
    ['a response varying on cookies', asset('x', { vary: 'Accept-Encoding, Cookie' })],
    ['a non-200 response', new Response('x', { status: 404, headers: { 'content-type': 'text/javascript', 'cache-control': 'immutable' } })],
  ])('refuses to store %s', (_, response) => {
    expect(isStorableAsset(response)).toBe(false);
  });

  it('stores only on GET, never from HEAD', async () => {
    const cache = new MemoryCache();
    const { deps: d, settle } = deps(async () => asset(), cache);
    await handle(new Request('https://a.example/assets/x-1.js', { method: 'HEAD' }), { ...env, EDGE_CACHE_MODE: 'on' }, d);
    await settle();
    expect(cache.entries.size).toBe(0);
  });
});

describe('origin timeout parsing', () => {
  it('clamps and defaults', () => {
    expect(originTimeoutMs({})).toBe(15_000);
    expect(originTimeoutMs({ ORIGIN_TIMEOUT_MS: '5' })).toBe(1000);
    expect(originTimeoutMs({ ORIGIN_TIMEOUT_MS: '999999' })).toBe(60_000);
    expect(originTimeoutMs({ ORIGIN_TIMEOUT_MS: 'abc' })).toBe(15_000);
  });
});
