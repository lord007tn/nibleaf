import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assetCacheKey,
  cacheControlDirectives,
  type EdgeCache,
  type EdgeDeps,
  edgeCacheMode,
  handle,
  isOriginFailure,
  isStorableAsset,
  originTimeoutMs,
  STATIC_BUILD_HEADER,
} from './index';
import { maintenanceLanguage, wantsHtml } from './maintenance';

const env = { APP_ORIGIN: 'https://nibleaf.com', EDGE_SECRET: 'server-only-secret' };
const cacheOn = { ...env, EDGE_CACHE_MODE: 'on' };

class MemoryCache implements EdgeCache {
  readonly entries = new Map<string, Response>();
  matches = 0;
  puts = 0;
  async match(request: Request) {
    this.matches += 1;
    return this.entries.get(request.url)?.clone();
  }
  async put(request: Request, response: Response) {
    this.puts += 1;
    this.entries.set(request.url, new Response(await response.arrayBuffer(), response));
  }
}

/** A cache that fails the test on any use: proves a path never touches it. */
const forbiddenCache = (): EdgeCache => ({
  match: () => {
    throw new Error('cache.match must not be called');
  },
  put: () => {
    throw new Error('cache.put must not be called');
  },
});

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

const HASHED = '/assets/main-AbCd12_-.js';

const asset = (body = 'console.log(1)', headers: Record<string, string> = {}) =>
  new Response(body, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
      [STATIC_BUILD_HEADER]: '1',
      vary: 'Accept-Encoding',
      ...headers,
    },
  });

afterEach(() => {
  vi.useRealTimers();
});

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
    expect(response.headers.get('vary')).toBe('Accept, Accept-Language, Sec-Fetch-Dest');
    expect(response.headers.get('strict-transport-security')).toBe('max-age=63072000; includeSubDomains');
    const html = await response.text();
    expect(html).toContain('docs.customer.com');
    expect(html).toContain('temporarily unavailable');
    expect(html).not.toContain('no available server');
    expect(html).not.toMatch(/<script/i);
  });

  it('sends HSTS only over HTTPS', async () => {
    const { deps: d } = deps(async () => new Response('', { status: 502 }));
    const response = await handle(new Request('http://docs.customer.com/', { headers: { accept: 'text/html' } }), env, d);
    expect(response.headers.has('strict-transport-security')).toBe(false);
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

describe('bounded origin waits', () => {
  it('times out a hanging origin read and answers with the page', async () => {
    vi.useFakeTimers();
    const { deps: d } = deps(
      (request) =>
        new Promise((_, reject) => {
          request.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const pending = handle(page(), { ...env, ORIGIN_TIMEOUT_MS: '5000' }, d);
    await vi.advanceTimersByTimeAsync(5000);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(response.headers.get('x-nibleaf-edge')).toBe('unavailable; reason=timeout');
  });

  it('never times out a write, however long the origin takes to answer', async () => {
    vi.useFakeTimers();
    let answer: (response: Response) => void = () => undefined;
    const { deps: d, seen } = deps(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const pending = handle(
      new Request('https://docs.customer.com/api/app/assets/upload', { method: 'POST', body: 'x'.repeat(1024) }),
      { ...env, ORIGIN_TIMEOUT_MS: '1000' },
      d,
    );
    await vi.advanceTimersByTimeAsync(120_000);
    expect(seen[0]?.signal.aborted).toBe(false);
    answer(new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }));
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');
  });

  it.each([
    ['a server-sent event stream', 'text/event-stream', ['data: one\n\n', 'data: two\n\n']],
    ['a slow download', 'application/octet-stream', ['chunk-1;', 'chunk-2;', 'chunk-3;']],
  ])('lets %s keep streaming long after the read timeout once headers arrived', async (_, type, chunks) => {
    vi.useFakeTimers();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    const { deps: d, seen } = deps(async () => new Response(body, { headers: { 'content-type': type, 'x-nibleaf-revision': 'r' } }));
    const response = await handle(
      new Request('https://docs.customer.com/api/public/sites/x/chat', { headers: { accept: type } }),
      { ...env, ORIGIN_TIMEOUT_MS: '1000' },
      d,
    );
    const encoder = new TextEncoder();
    for (const chunk of chunks) {
      await vi.advanceTimersByTimeAsync(10_000);
      controller?.enqueue(encoder.encode(chunk));
    }
    controller?.close();
    expect(await response.text()).toBe(chunks.join(''));
    expect(seen[0]?.signal.aborted).toBe(false);
  });

  it('clamps and defaults the timeout', () => {
    expect(originTimeoutMs({})).toBe(15_000);
    expect(originTimeoutMs({ ORIGIN_TIMEOUT_MS: '5' })).toBe(1000);
    expect(originTimeoutMs({ ORIGIN_TIMEOUT_MS: '999999' })).toBe(60_000);
    expect(originTimeoutMs({ ORIGIN_TIMEOUT_MS: 'abc' })).toBe(15_000);
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
  it('is off unless the mode is set explicitly', () => {
    expect(edgeCacheMode({})).toBe('off');
    expect(edgeCacheMode({ EDGE_CACHE_MODE: 'ON' })).toBe('on');
    expect(edgeCacheMode({ EDGE_CACHE_MODE: 'stale-only' })).toBe('stale-only');
    expect(edgeCacheMode({ EDGE_CACHE_MODE: 'yes' })).toBe('off');
  });

  it('never touches the cache in off mode, or for documents and API calls in any mode', async () => {
    const { deps: off } = deps(async () => asset(), forbiddenCache());
    expect((await handle(new Request(`https://a.example${HASHED}`), env, off)).status).toBe(200);
    const { deps: on } = deps(
      async () => new Response('<html>', { headers: { 'content-type': 'text/html', 'x-nibleaf-revision': 'r' } }),
      forbiddenCache(),
    );
    expect((await handle(page(), cacheOn, on)).status).toBe(200);
    expect((await handle(new Request('https://a.example/api/public/sites/x'), cacheOn, on)).status).toBe(200);
    expect((await handle(new Request('https://a.example/assets/dashboard-preloads.json'), cacheOn, on)).status).toBe(200);
  });

  it('shares one entry per hashed path across hostnames and serves it without the origin', async () => {
    const cache = new MemoryCache();
    let calls = 0;
    const { deps: d, settle } = deps(async () => {
      calls += 1;
      return asset();
    }, cache);
    const first = await handle(new Request(`https://a.example${HASHED}`), cacheOn, d);
    expect(first.headers.get('x-nibleaf-edge')).toBe('miss');
    expect(await first.text()).toBe('console.log(1)');
    await settle();
    expect([...cache.entries.keys()]).toEqual([`https://nibleaf.com/__nibleaf_edge/v1/app-assets${HASHED}`]);
    const second = await handle(new Request(`https://b.example${HASHED}`), cacheOn, d);
    expect(second.headers.get('x-nibleaf-edge')).toBe('hit');
    expect(await second.text()).toBe('console.log(1)');
    expect(calls).toBe(1);
  });

  it('uses one key whatever encoding the reader accepts, and serves gzip, Brotli and identity readers', async () => {
    const encodings = ['gzip, deflate', 'br', 'identity', ''];
    const keys = encodings.map(
      (encoding) => assetCacheKey(new Request(`https://a.example${HASHED}`, { headers: { 'accept-encoding': encoding } }), env)?.url,
    );
    expect(new Set(keys).size).toBe(1);
    const cache = new MemoryCache();
    const { deps: d, settle } = deps(async () => asset(), cache);
    await handle(new Request(`https://a.example${HASHED}`, { headers: { 'accept-encoding': 'br' } }), cacheOn, d);
    await settle();
    for (const encoding of encodings) {
      const response = await handle(new Request(`https://b.example${HASHED}`, { headers: { 'accept-encoding': encoding } }), cacheOn, d);
      expect(response.headers.get('x-nibleaf-edge')).toBe('hit');
      expect(await response.text()).toBe('console.log(1)');
    }
  });

  it('refuses a stored entry in an encoding the reader does not accept', async () => {
    const cache = new MemoryCache();
    cache.entries.set(`https://nibleaf.com/__nibleaf_edge/v1/app-assets${HASHED}`, asset('BR-BYTES', { 'content-encoding': 'br' }));
    const { deps: d } = deps(async () => asset(), cache);
    const identity = await handle(new Request(`https://a.example${HASHED}`, { headers: { 'accept-encoding': 'gzip' } }), cacheOn, d);
    expect(identity.headers.get('x-nibleaf-edge')).toBe('miss');
    expect(await identity.text()).toBe('console.log(1)');
    const brotli = await handle(new Request(`https://a.example${HASHED}`, { headers: { 'accept-encoding': 'gzip, br' } }), cacheOn, d);
    expect(brotli.headers.get('x-nibleaf-edge')).toBe('hit');
  });

  it('serves a cached asset while the origin is down', async () => {
    const cache = new MemoryCache();
    const stale = { ...env, EDGE_CACHE_MODE: 'stale-only' };
    const warm = deps(async () => asset(), cache);
    await handle(new Request(`https://a.example${HASHED}`), stale, warm.deps);
    await warm.settle();
    const down = deps(async () => new Response('no available server', { status: 503 }), cache);
    const response = await handle(new Request(`https://a.example${HASHED}`), stale, down.deps);
    expect(response.status).toBe(200);
  });

  it.each([
    ['/assets/dashboard-preloads.json', 'a mutable build manifest'],
    ['/assets/main.js', 'an unhashed name'],
    ['/assets/main-abc.js', 'a short hash'],
    ['/assets/main-AbCd1234.html', 'a non-asset extension'],
    [`${HASHED}?v=1`, 'a query string'],
    ['/assets/../main-AbCd1234.js', 'traversal'],
    ['/assets/nested/main-AbCd1234.js', 'a nested path'],
    ['/guides/assets/main-AbCd1234.js', 'a non-root asset path'],
  ])('never keys %s (%s)', (path) => {
    expect(assetCacheKey(new Request(`https://a.example${path}`), env)).toBeNull();
  });

  it.each([
    '/assets/main-AbCd1234.js',
    '/assets/_projectId-wN2jK9i-.js',
    '/assets/circle-question-mark-DeqH1urU.js',
    '/assets/styles-Xy_9zZ0a.css',
    '/assets/inter-latin-AbCd1234.woff2',
  ])('keys the content-hashed build file %s', (path) => {
    expect(assetCacheKey(new Request(`https://a.example${path}`), env)).not.toBeNull();
  });

  it('never keys writes', () => {
    expect(assetCacheKey(new Request(`https://a.example${HASHED}`, { method: 'POST' }), env)).toBeNull();
  });

  it('parses Cache-Control as directives, not substrings', () => {
    const directives = cacheControlDirectives('public, max-age=31536000, Immutable, no-transform');
    expect(directives.has('immutable')).toBe(true);
    expect(directives.get('max-age')).toBe('31536000');
    expect(isStorableAsset(asset('x', { 'cache-control': 'public, max-age=60, x-not-immutable' }))).toBe(false);
    expect(isStorableAsset(asset('x', { 'cache-control': 'public, max-age=31536000, immutable' }))).toBe(true);
  });

  it.each([
    ['a response without the static-build marker', asset('x', { [STATIC_BUILD_HEADER]: '' })],
    ['a response with a wrong marker value', asset('x', { [STATIC_BUILD_HEADER]: 'yes' })],
    ['a non-immutable response', asset('x', { 'cache-control': 'public, max-age=60' })],
    ['an immutable response that also says no-cache', asset('x', { 'cache-control': 'public, immutable, no-cache' })],
    ['a private response', asset('x', { 'cache-control': 'private, immutable' })],
    ['a no-store response', asset('x', { 'cache-control': 'no-store, immutable' })],
    ['an HTML fallback', asset('<html>', { 'content-type': 'text/html' })],
    ['a response setting a cookie', asset('x', { 'set-cookie': 'a=b' })],
    ['a response varying on cookies', asset('x', { vary: 'Accept-Encoding, Cookie' })],
    [
      'a non-200 response',
      new Response('x', { status: 404, headers: { 'content-type': 'text/javascript', 'cache-control': 'immutable', [STATIC_BUILD_HEADER]: '1' } }),
    ],
  ])('refuses to store %s', (_, response) => {
    expect(isStorableAsset(response)).toBe(false);
  });

  it('does not store an unmarked asset end to end, and asks the origin again next time', async () => {
    const cache = new MemoryCache();
    const { deps: d, settle, seen } = deps(async () => asset('x', { [STATIC_BUILD_HEADER]: '' }), cache);
    await handle(new Request(`https://a.example${HASHED}`), cacheOn, d);
    await settle();
    await handle(new Request(`https://a.example${HASHED}`), cacheOn, d);
    expect(cache.puts).toBe(0);
    expect(seen).toHaveLength(2);
  });

  it('stores only on GET, never from HEAD', async () => {
    const cache = new MemoryCache();
    const { deps: d, settle } = deps(async () => asset(), cache);
    await handle(new Request(`https://a.example${HASHED}`, { method: 'HEAD' }), cacheOn, d);
    await settle();
    expect(cache.puts).toBe(0);
  });
});
