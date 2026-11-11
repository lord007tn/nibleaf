import { unavailableResponse } from './maintenance';

export interface Env {
  APP_ORIGIN: string;
  EDGE_SECRET: string;
  /** `off` (default), `stale-only` or `on`. Anything else is treated as `off`.
   *  This release only uses it to gate the immutable build-asset cache; the
   *  document cache ships separately. Set outside this repository. */
  EDGE_CACHE_MODE?: string;
  /** Milliseconds to wait for origin response headers on GET/HEAD. */
  ORIGIN_TIMEOUT_MS?: string;
}

type EdgeCacheMode = 'off' | 'stale-only' | 'on';

/** Narrow interface over `caches.default`, so tests can supply an in-memory cache. */
export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface EdgeDeps {
  fetch: (request: Request) => Promise<Response>;
  cache: EdgeCache | null;
  waitUntil: (promise: Promise<unknown>) => void;
}

const EDGE_HOST_HEADER = 'x-nibleaf-custom-host';
const EDGE_SECRET_HEADER = 'x-nibleaf-edge-secret';
const DEFAULT_ORIGIN_TIMEOUT_MS = 15_000;
const MIN_ORIGIN_TIMEOUT_MS = 1000;
const MAX_ORIGIN_TIMEOUT_MS = 60_000;

export const edgeCacheMode = (env: Pick<Env, 'EDGE_CACHE_MODE'>): EdgeCacheMode => {
  const value = env.EDGE_CACHE_MODE?.trim().toLowerCase();
  return value === 'stale-only' || value === 'on' ? value : 'off';
};

export const originTimeoutMs = (env: Pick<Env, 'ORIGIN_TIMEOUT_MS'>): number => {
  const parsed = Number.parseInt(env.ORIGIN_TIMEOUT_MS ?? '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_ORIGIN_TIMEOUT_MS;
  return Math.min(MAX_ORIGIN_TIMEOUT_MS, Math.max(MIN_ORIGIN_TIMEOUT_MS, parsed));
};

export const proxyRequest = (request: Request, env: Env, signal?: AbortSignal): Request => {
  const incoming = new URL(request.url);
  const hostname = incoming.hostname.toLowerCase();
  const target = new URL(env.APP_ORIGIN);
  const origin = target.origin;
  if (
    !['http:', 'https:'].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.pathname !== '/' ||
    target.search ||
    target.hash
  ) {
    throw new Error('Invalid app origin.');
  }
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  if (target.origin !== origin) throw new Error('Invalid proxy target.');
  const headers = new Headers(request.headers);
  headers.delete(EDGE_HOST_HEADER);
  headers.delete(EDGE_SECRET_HEADER);
  headers.set(EDGE_HOST_HEADER, hostname);
  headers.set(EDGE_SECRET_HEADER, env.EDGE_SECRET);
  // Authoritative forwarding fields from what the reader actually requested;
  // never whatever the client sent. The origin builds canonical URLs from them.
  headers.set('x-forwarded-host', hostname);
  headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''));
  return new Request(target, {
    method: request.method,
    headers,
    body: request.body,
    // Every customer hostname is proxied through the same app origin URL.
    // Bypass Cloudflare's subrequest cache so one site's robots, sitemap, or
    // HTML can never be replayed to a different hostname.
    cache: 'no-store',
    redirect: 'manual',
    ...(signal ? { signal } : {}),
    // Required by the WHATWG fetch spec (and Node) for streamed bodies; the
    // Workers runtime streams request bodies regardless.
    ...(request.body ? ({ duplex: 'half' } as RequestInit) : {}),
  });
};

/** Statuses the proxy chain (Traefik "no available server", Cloudflare's 52x
 *  origin errors) produces when the Nibleaf origin is down or restarting. */
const GATEWAY_FAILURE_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

/** True when the response is the proxy chain reporting an unreachable origin,
 *  rather than a deliberate answer from Nibleaf itself. The app stamps every
 *  response it renders with `x-nibleaf-revision`, and the API answers in JSON;
 *  those are passed through untouched, whatever their status. */
export const isOriginFailure = (response: Response): boolean => {
  if (!GATEWAY_FAILURE_STATUSES.has(response.status)) return false;
  if (response.headers.has('x-nibleaf-revision')) return false;
  const type = response.headers.get('content-type')?.toLowerCase() ?? '';
  return !(type.includes('application/json') || type.includes('+json'));
};

// ─── Immutable build assets ──────────────────────────────────────────────────
// `/assets/<name>-<hash>.<ext>` files are content-addressed outputs of the one
// app build that serves every tenant, so a single cache entry per path is shared
// by all hostnames on purpose. Three independent conditions must all hold before
// anything is stored: the path carries Vite's content hash (so mutable files
// such as `/assets/dashboard-preloads.json` never qualify), the origin marks the
// response as static build output, and Cache-Control carries the `immutable`
// directive without `private`, `no-store` or `no-cache`.

/** Vite's default `[name]-[hash].[ext]`: an 8-character base64url content hash. */
const HASHED_ASSET_PATH =
  /^\/assets\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,200}-[A-Za-z0-9_-]{8}\.(?:js|mjs|css|woff2?|ttf|otf|svg|png|jpe?g|webp|avif|gif|ico|wasm)$/;
/** Set by the app's Nitro route rule for `/assets/**` (apps/app/vite.config.ts). */
export const STATIC_BUILD_HEADER = 'x-nibleaf-static-build';

/** Keyed under the app origin (a hostname in the Worker's own zone) with a
 *  reserved prefix no reader request is ever looked up under. The key ignores
 *  Accept-Encoding: the runtime stores decoded bodies and re-encodes per reader,
 *  and `cachedAssetFor` refuses an entry whose encoding the reader can't take. */
export const assetCacheKey = (request: Request, env: Pick<Env, 'APP_ORIGIN'>): Request | null => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  if (url.search || url.pathname.includes('..') || !HASHED_ASSET_PATH.test(url.pathname)) return null;
  return new Request(`${new URL(env.APP_ORIGIN).origin}/__nibleaf_edge/v1/app-assets${url.pathname}`, { method: 'GET' });
};

/** Cache-Control directives as a lowercase name → value map (RFC 9111 §5.2). */
export const cacheControlDirectives = (value: string | null): Map<string, string> => {
  const directives = new Map<string, string>();
  for (const part of (value ?? '').split(',')) {
    const [rawName, ...rest] = part.split('=');
    const name = rawName?.trim().toLowerCase();
    if (name) directives.set(name, rest.join('=').trim().replace(/^"|"$/g, ''));
  }
  return directives;
};

export const isStorableAsset = (response: Response): boolean => {
  if (response.status !== 200) return false;
  if (response.headers.has('set-cookie')) return false;
  if (response.headers.get(STATIC_BUILD_HEADER) !== '1') return false;
  const directives = cacheControlDirectives(response.headers.get('cache-control'));
  if (!directives.has('immutable') || directives.has('private') || directives.has('no-store') || directives.has('no-cache')) return false;
  const vary = response.headers.get('vary')?.toLowerCase() ?? '';
  if (vary.split(',').some((name) => name.trim() && name.trim() !== 'accept-encoding')) return false;
  const type = response.headers.get('content-type')?.toLowerCase() ?? '';
  return Boolean(type) && !type.includes('text/html');
};

const acceptsEncoding = (request: Request, encoding: string): boolean => {
  if (encoding === 'identity') return true;
  return (request.headers.get('accept-encoding') ?? '')
    .toLowerCase()
    .split(',')
    .some((part) => {
      const [name, ...params] = part.trim().split(';');
      const q = params.find((param) => param.trim().startsWith('q='));
      return (name === encoding || name === '*') && !(q && Number.parseFloat(q.trim().slice(2)) === 0);
    });
};

/** A stored asset is served only if the reader accepts its stored encoding. */
const usableCachedAsset = (request: Request, cached: Response): boolean =>
  acceptsEncoding(request, cached.headers.get('content-encoding')?.trim().toLowerCase() || 'identity');

const withEdgeStatus = (response: Response, status: string): Response => {
  const copy = new Response(response.body, response);
  copy.headers.set('x-nibleaf-edge', status);
  return copy;
};

const withoutBody = (response: Response, method: string): Response =>
  method === 'HEAD' ? new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers }) : response;

// ─── Origin fetch with bounded wait ──────────────────────────────────────────

type OriginResult = { ok: true; response: Response } | { ok: false; reason: 'timeout' | 'network' };

const fetchOrigin = async (request: Request, env: Env, deps: EdgeDeps): Promise<OriginResult> => {
  // Only reads are bounded: uploads and streamed answers can legitimately take
  // longer to produce headers, and the timer stops once headers arrive so a
  // streaming body is never cut off.
  const bounded = request.method === 'GET' || request.method === 'HEAD';
  const controller = bounded ? new AbortController() : null;
  let timedOut = false;
  const timer = controller
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, originTimeoutMs(env))
    : null;
  try {
    const response = await deps.fetch(proxyRequest(request, env, controller?.signal));
    return { ok: true, response };
  } catch {
    return { ok: false, reason: timedOut ? 'timeout' : 'network' };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const handle = async (request: Request, env: Env, deps: EdgeDeps): Promise<Response> => {
  if (!env.EDGE_SECRET || !env.APP_ORIGIN) return unavailableResponse(request, 'config');
  try {
    proxyRequest(new Request(request.url, { method: 'GET' }), env);
  } catch {
    return unavailableResponse(request, 'config');
  }

  const mode = edgeCacheMode(env);
  const assetKey = mode === 'off' || !deps.cache ? null : assetCacheKey(request, env);
  if (assetKey && deps.cache) {
    const cached = await deps.cache.match(assetKey).catch(() => undefined);
    if (cached && usableCachedAsset(request, cached)) return withoutBody(withEdgeStatus(cached, 'hit'), request.method);
  }

  const result = await fetchOrigin(request, env, deps);
  if (!result.ok) return unavailableResponse(request, result.reason);
  const { response } = result;
  if (isOriginFailure(response)) {
    // Drain the proxy's error body; the reader gets the edge page instead.
    deps.waitUntil(response.body?.cancel().catch(() => undefined) ?? Promise.resolve());
    return unavailableResponse(request, `origin-${response.status}`);
  }

  if (assetKey && deps.cache && request.method === 'GET' && isStorableAsset(response)) {
    const [forReader, forCache] = response.body ? response.body.tee() : [null, null];
    const stored = new Response(forCache, response);
    stored.headers.delete('x-nibleaf-edge');
    deps.waitUntil(deps.cache.put(assetKey, stored).catch(() => undefined));
    return withEdgeStatus(new Response(forReader, response), 'miss');
  }
  return response;
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handle(request, env, {
      fetch: (forwarded) => fetch(forwarded),
      cache: typeof caches === 'undefined' ? null : (caches as unknown as { default: EdgeCache }).default,
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
  },
} satisfies ExportedHandler<Env>;
