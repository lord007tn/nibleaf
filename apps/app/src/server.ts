import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { requestInterfaceLocale, withInterfaceLocale } from '@nibleaf/i18n/request-locale';
import { clientIpFromForwardedFor } from '@nibleaf/shared/client-ip';
import {
  canonicalPathFromMarkdownAlias,
  decodePublishedPathname,
  documentUrlForBase,
  markdownAliasPath,
  markdownAlternateUrl,
  markdownDiscoveryLinkHeader,
} from '@nibleaf/shared/markdown-discovery';
import { legacySiteLanguageTarget, type PathLanguage, parseSiteLanguagePath } from '@nibleaf/shared/site-language';
import type { Register } from '@tanstack/react-router';
import { createStartHandler, defaultStreamHandler, type RequestHandler } from '@tanstack/react-start/server';
import { createServerEntry } from '@tanstack/react-start/server-entry';
import got from 'got';
import { z } from 'zod';
import { serverEnv } from '@/env.server';
import { contentSecurityPolicy } from '@/lib/content-security-policy';
import { observeCrawlerResponse } from '@/lib/crawler-hits';
import { marketingHashResponse } from '@/lib/marketing-csp.server';
import { marketingLlms, marketingLlmsFull, marketingPricingMarkdown } from '@/lib/marketing-llms';
import { agentFriendlyNotFoundMarkdown, marketingMarkdownResponse } from '@/lib/marketing-markdown';
import { renderMarketing } from '@/lib/marketing-render.server';
import { marketingSitemap, marketingSitemapEntries } from '@/lib/marketing-sitemap';
import { nibleafPublicOpenApi } from '@/lib/nibleaf-openapi';
import { encodePublicRouteManifestResponse } from '@/lib/public-route-manifest';
import { readerRateLimitResponse } from '@/lib/reader-rate-limit';
import {
  acceptsHtml,
  appendVary,
  asHtmlRenderRequest,
  isAppOwnedPath,
  isDocumentPath,
  notAcceptableHtmlResponse,
  preferredRepresentation,
} from '@/lib/request-negotiation';
import { renderSelfHostInstaller } from '@/lib/self-host-release';
import { proxySiteOg } from '@/lib/site-og-proxy.server';
import { SITE_MARKDOWN_ALTERNATE_HEADER } from '@/lib/site-seo';
import { ssrNonce } from '@/lib/ssr-nonce.server';
import { apiOrigin } from '@/services/api-origin';
import PRODUCTION_COMPOSE from '../../../release/published/docker-compose.yml?raw';
import INSTALL_SCRIPT from '../../../release/published/install.sh?raw';

/**
 * Custom server entry. Wraps TanStack Start's request handler to add
 * custom-domain serving: a request arriving on a connected, verified custom
 * domain is rewritten to the existing `/sites/:projectId/*` site routes, so the
 * domain serves the published docs at its own root (no redirect, URL preserved).
 * The dashboard's own host and internal/proxy paths are passed through untouched.
 *
 * It also owns the published-site edge concerns:
 *  - robots.txt / sitemap.xml / llms.txt / llms-full.txt at both origins,
 *  - 301 consolidation of secondary origins onto a verified primary domain,
 *  - a shared Cache-Control on public published-site HTML,
 *  - stamping the real visitor IP onto SSR loader fetches (x-nibleaf-client-ip)
 *    so the API rate-limiter doesn't key every SSR render on this container.
 */

// Rewritten published-site requests own a separate Start request context. Convert
// errors inside that context before leaving it, preserving headers and cookies.
const startHandler = createServerEntry({
  fetch: createStartHandler(async (context) => {
    const result = await (ssrNonce.getStore() === '' ? renderMarketing(context) : defaultStreamHandler(context));
    return readerRateLimitResponse(
      result,
      context.router.state.matches.map((match) => match.error),
    );
  }),
}).fetch;

// Reach the API through the app's own same-origin /api proxy — this is the path
// that works both in the container (where the server is a separate host) and in
// dev, matching how the SSR data loaders fetch.
const SELF = apiOrigin();

const ownHosts = new Set(
  [serverEnv.APP_URL, 'localhost:4310', '127.0.0.1:4310'].map(
    (url) =>
      String(url)
        .replace(/^https?:\/\//, '')
        .split('/')[0]
        ?.toLowerCase() ?? '',
  ),
);

// Paths the app serves itself — never rewritten to a site route.
// The public cloud marketing brand host. Only a deployment whose configured app
// origin IS this host serves the marketing SEO docs (robots/sitemap/llms that
// advertise "Nibleaf Cloud" and link nibleaf.com's sitemap). A self-hoster's
// APP_URL points at their OWN dashboard, so IS_CLOUD_MARKETING is false for them
// and they get a minimal, self-referential robots.txt with no marketing docs.
const MARKETING_HOST = 'nibleaf.com';
const CONFIGURED_HOST = serverEnv.APP_URL.replace(/^https?:\/\//, '')
  .split('/')[0]
  ?.toLowerCase();
const IS_CLOUD_MARKETING = CONFIGURED_HOST === MARKETING_HOST;
const REVISION = process.env.NIBLEAF_REVISION ?? 'development';
const DRAIN_FILE = process.env.NIBLEAF_DRAIN_FILE ?? '/tmp/nibleaf-draining';

/** Compatibility copies of the public self-hosting artifacts. The documented
 * command uses versioned GitHub release assets and verifies their committed
 * digests; these routes remain available for existing operators. */
function serveSelfHostingArtifact(pathname: string, bare: string): Response | null {
  if (!IS_CLOUD_MARKETING || bare !== MARKETING_HOST) {
    return null;
  }
  const artifacts: Record<string, { body: string; type: string; filename: string }> = {
    '/install.sh': { body: renderSelfHostInstaller(INSTALL_SCRIPT), type: 'text/x-shellscript; charset=utf-8', filename: 'nibleaf-install.sh' },
    '/docker-compose.yml': { body: PRODUCTION_COMPOSE, type: 'application/yaml; charset=utf-8', filename: 'docker-compose.yml' },
  };
  const artifact = artifacts[pathname];
  if (!artifact) {
    return null;
  }
  return new Response(artifact.body, {
    headers: {
      'cache-control': 'public, max-age=300',
      'content-disposition': `inline; filename="${artifact.filename}"`,
      'content-type': artifact.type,
      'x-content-type-options': 'nosniff',
    },
  });
}

// ─── Visitor IP forwarding for SSR loader fetches ────────────────────────────
// SSR data loaders fetch the API from THIS process, so without help every page
// render shares the container's one rate-limit bucket. We capture the visitor's
// IP per request (AsyncLocalStorage) and stamp it as `x-nibleaf-client-ip` on
// fetches to our own /api proxy; the API only honours the header when its direct
// peer is a private address (see apps/server/src/middlewares/rate-limit.ts).

interface PublishedRequestAuth {
  ip: string | null;
  cookie: string | null;
  authorization: string | null;
  userAgent?: string;
}
const publishedRequestAuth = new AsyncLocalStorage<PublishedRequestAuth>();

// Shared secret proving to the API that `x-nibleaf-client-ip` was stamped by
// THIS server entry (and not spoofed by a browser through the nitro /api
// proxy, which forwards request headers). Must match the API's
// INTERNAL_API_SECRET; when unset the API simply ignores the hint.
const INTERNAL_API_SECRET = serverEnv.INTERNAL_API_SECRET ?? '';

// Cloudflare for SaaS terminates customer TLS at the edge and proxies every
// vanity hostname to one DNS-only origin. Trust the original hostname only
// when the Worker proves it with a server-only shared secret.
const CUSTOM_DOMAIN_EDGE_SECRET = serverEnv.CUSTOM_DOMAIN_EDGE_SECRET ?? '';
const safeSecretMatch = (left: string, right: string): boolean => {
  if (!(left && right)) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

const effectiveRequestHost = (request: Request, url: URL): string => {
  const edgeSecret = request.headers.get('x-nibleaf-edge-secret') || '';
  const edgeHost = request.headers.get('x-nibleaf-custom-host')?.trim().toLowerCase() || '';
  if (safeSecretMatch(edgeSecret, CUSTOM_DOMAIN_EDGE_SECRET) && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(edgeHost)) {
    return edgeHost;
  }
  return (request.headers.get('host') || url.host).toLowerCase();
};

// Patch global fetch (the RPC client in src/services/api.ts uses it) so SSR fetches
// to our own /api proxy carry the visitor's IP. Requests outside the request
// context (no store) and to other targets are passed through untouched.
const baseFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const requestAuth = publishedRequestAuth.getStore();
  if (requestAuth) {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (target.startsWith(`${SELF}/api/`)) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      // Always overwrite: an inbound (possibly attacker-supplied) value must
      // never ride along on our authenticated internal hint.
      if (requestAuth.ip) headers.set('x-nibleaf-client-ip', requestAuth.ip);
      // Non-secret analytics hint: the outer request is observed here, so the API must not count this fetch as a crawl.
      headers.set('x-nibleaf-ssr', '1');
      // The secret only proves the client-IP hint, so it rides along only with one.
      if (requestAuth.ip && INTERNAL_API_SECRET) {
        headers.set('x-nibleaf-internal', INTERNAL_API_SECRET);
      }
      // SSR loaders and edge metadata/SEO fetches must make the same access
      // decision as the browser request. Forward only credentials, never the
      // full inbound header bag.
      if (requestAuth.userAgent) headers.set('user-agent', requestAuth.userAgent);
      if (requestAuth.cookie) headers.set('cookie', requestAuth.cookie);
      if (requestAuth.authorization) headers.set('authorization', requestAuth.authorization);
      return baseFetch(input, { ...init, headers });
    }
  }
  return baseFetch(input, init);
}) as typeof fetch;

const internalRequestHeaders = () => {
  const requestAuth = publishedRequestAuth.getStore();
  return {
    ...(requestAuth?.ip ? { 'x-nibleaf-client-ip': requestAuth.ip } : {}),
    'x-nibleaf-ssr': '1',
    ...(requestAuth?.ip && INTERNAL_API_SECRET ? { 'x-nibleaf-internal': INTERNAL_API_SECRET } : {}),
    ...(requestAuth?.cookie ? { cookie: requestAuth.cookie } : {}),
    ...(requestAuth?.authorization ? { authorization: requestAuth.authorization } : {}),
  };
};

/** Headers of a proxied site document worth passing on: cacheability, what it
 *  varies on, and whether it may be indexed. A private site's document is the
 *  signed-in viewer's own (`private, no-store`, `Vary: Cookie, Authorization`,
 *  `noindex`); a public one stays shared-cacheable. */
const passThroughDocumentHeaders = (upstream: Record<string, string | string[] | undefined>): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const name of ['cache-control', 'vary', 'x-robots-tag']) {
    const value = upstream[name];
    if (typeof value === 'string' && value) headers[name] = value;
  }
  return headers;
};

// ─── Custom-domain host → project resolution ─────────────────────────────────

const cache = new Map<string, { projectId: string | null; at: number }>();
const TTL = 30_000;

async function resolveHost(host: string): Promise<string | null> {
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL) {
    return hit.projectId;
  }
  try {
    const response = await got(`${SELF}/api/public/domains/resolve?host=${encodeURIComponent(host)}`, {
      headers: internalRequestHeaders(),
      responseType: 'json',
      retry: { limit: 0 },
      throwHttpErrors: false,
    });
    const parsed = z.object({ data: z.object({ projectId: z.string().nullable().optional() }).optional() }).safeParse(response.body);
    const projectId = response.ok && parsed.success ? (parsed.data.data?.projectId ?? null) : null;
    cache.set(host, { projectId, at: Date.now() });
    return projectId;
  } catch {
    return null;
  }
}

/** A site slug is a DNS label (`projectSlug` in @nibleaf/validators): anything
 *  else can't name a site, so it is answered without a lookup or a cache entry. */
const SITE_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** Slug answers kept at once. Least recently used first out; expired entries go when read. */
const SLUG_CACHE_LIMIT = 1000;
const slugCache = new Map<string, { projectId: string | null; at: number }>();

const rememberSlug = (slug: string, projectId: string | null): void => {
  slugCache.delete(slug);
  slugCache.set(slug, { projectId, at: Date.now() });
  while (slugCache.size > SLUG_CACHE_LIMIT) {
    const oldest = slugCache.keys().next().value;
    if (oldest === undefined) break;
    slugCache.delete(oldest);
  }
};

/** The public, live site whose slug is `slug` (`/sites/<slug>` written by hand,
 *  or copied from the dashboard), or null. Only a definite answer from the API
 *  is cached; a failed lookup is tried again next time. */
export async function resolveSiteSlug(slug: string): Promise<string | null> {
  if (!SITE_SLUG.test(slug)) return null;
  const hit = slugCache.get(slug);
  if (hit) {
    if (Date.now() - hit.at < TTL) {
      // Read again: move it to the most recently used end.
      slugCache.delete(slug);
      slugCache.set(slug, hit);
      return hit.projectId;
    }
    slugCache.delete(slug);
  }
  try {
    const response = await got(`${SELF}/api/public/domains/slug?slug=${encodeURIComponent(slug)}`, {
      headers: internalRequestHeaders(),
      responseType: 'json',
      retry: { limit: 0 },
      throwHttpErrors: false,
    });
    const parsed = z.object({ data: z.object({ projectId: z.string().nullable().optional() }).optional() }).safeParse(response.body);
    if (!response.ok || !parsed.success) return null;
    const projectId = parsed.data.data?.projectId ?? null;
    rememberSlug(slug, projectId);
    return projectId;
  } catch {
    return null;
  }
}

/** For tests: how many slug answers are kept. */
export const slugCacheSize = (): number => slugCache.size;

// ─── Published-site metadata (privacy + primary domain) ──────────────────────

/** What the edge needs to know about a published site: whether its HTML may be
 *  shared-cached, and which host is its canonical (primary) home. */
interface SiteMeta {
  /** Verified primary custom domain, when configured. */
  primaryDomain: string | null;
  isPrivate: boolean;
  languages: PathLanguage[];
}

const siteMetaCache = new Map<string, { meta: SiteMeta | null; at: number }>();
const siteMetaRequests = new Map<string, Promise<SiteMeta | null>>();
const SITE_META_TTL = 60_000;

/** Fetch (and TTL-cache) the site shell's metadata. Returns null when the site
 *  is unknown/unpublished/private-to-anonymous — callers must then behave
 *  conservatively (no cache header, no redirect). */
async function resolveSiteMeta(projectId: string): Promise<SiteMeta | null> {
  const requestHasCredentials = Boolean(publishedRequestAuth.getStore()?.cookie || publishedRequestAuth.getStore()?.authorization);
  const hit = requestHasCredentials ? undefined : siteMetaCache.get(projectId);
  if (hit && Date.now() - hit.at < SITE_META_TTL) {
    return hit.meta;
  }
  // A cold reader burst shares only anonymous metadata. Each credentialed
  // request still resolves its own viewer-dependent result.
  if (requestHasCredentials) return loadSiteMeta(projectId, true);
  const existing = siteMetaRequests.get(projectId);
  if (existing) return existing;
  const pending = loadSiteMeta(projectId, false);
  siteMetaRequests.set(projectId, pending);
  try {
    return await pending;
  } finally {
    siteMetaRequests.delete(projectId);
  }
}

async function loadSiteMeta(projectId: string, requestHasCredentials: boolean): Promise<SiteMeta | null> {
  let meta: SiteMeta | null = null;
  try {
    const response = await got(`${SELF}/api/public/sites/${projectId}`, {
      headers: internalRequestHeaders(),
      responseType: 'json',
      retry: { limit: 0 },
      throwHttpErrors: false,
      timeout: { request: 5000 },
    });
    if (response.ok) {
      const parsed = z
        .object({
          data: z
            .object({
              languages: z.array(z.object({ code: z.string(), isDefault: z.boolean() })).optional(),
              project: z
                .object({
                  config: z.looseObject({ visibility: z.string().optional() }).nullable().optional(),
                  primaryDomain: z.string().nullable(),
                })
                .optional(),
            })
            .optional(),
        })
        .safeParse(response.body);
      const project = parsed.success ? parsed.data.data?.project : undefined;
      if (project) {
        const primary = project.primaryDomain?.trim().toLowerCase() ?? '';
        meta = {
          languages: parsed.success ? (parsed.data.data?.languages ?? []) : [],
          primaryDomain: primary || null,
          isPrivate: (project.config as { visibility?: string } | null)?.visibility === 'private',
        };
      }
    }
  } catch {
    // API unreachable — treat as unknown.
  }
  if (siteMetaCache.size > 500) {
    siteMetaCache.clear();
  }
  // Never share-cache credential-dependent metadata or anonymous misses: doing
  // so would let one viewer's state affect another viewer's redirect decision.
  if (!requestHasCredentials && meta && !meta.isPrivate) siteMetaCache.set(projectId, { meta, at: Date.now() });
  return meta;
}

// ─── SEO / machine-readable files ─────────────────────────────────────────────

/** Files served at a custom domain's root (not rewritten into site routes). */
const DOMAIN_SEO_FILE = /^\/(robots\.txt|sitemap\.xml|llms\.txt|llms-full\.txt|changelog\/rss\.xml)$/;
/** The same files under the app origin's /sites/:id/ prefix. */
const APP_SEO_FILE = /^\/sites\/([^/]+)\/(robots\.txt|sitemap\.xml|llms\.txt|llms-full\.txt|changelog\/rss\.xml)$/;

const SEO_CONTENT_TYPE: Record<string, string> = {
  'robots.txt': 'text/plain; charset=utf-8',
  'sitemap.xml': 'application/xml; charset=utf-8',
  'llms.txt': 'text/plain; charset=utf-8',
  'llms-full.txt': 'text/plain; charset=utf-8',
  'pricing.md': 'text/markdown; charset=utf-8',
  'openapi.json': 'application/json; charset=utf-8',
  'changelog/rss.xml': 'application/rss+xml; charset=utf-8',
};

/** Result of proxying a site's SEO document from the API:
 *  - `{ ok: true }`  → a 2xx upstream document, ready to serve;
 *  - `{ ok: false }` → the API answered with an error status (e.g. 404/403 for a
 *    private/unpublished/taken-down site) — the site is NOT crawlable;
 *  - `null`          → the API was unreachable (genuine network error).
 *  The distinction matters: a private site must be kept out of crawlers, not
 *  handed the permissive allow-all fallback that an "API down" case once shared
 *  with it. */
type SeoProxyResult = { ok: true; response: Response } | { ok: false; status: number };

/** Proxy a site's public SEO document from the API, preserving its content type
 *  and cacheability. When `origin` is given (custom-domain serving), absolute
 *  URLs pointing at the internal /sites/:id form are rebased onto the domain
 *  root — same rewrite for sitemap `loc`s and llms.txt page links. Returns null
 *  ONLY on a network error; an upstream error status is surfaced as
 *  `{ ok: false, status }`. */
async function proxySeoDocument(projectId: string, file: string, origin?: string): Promise<SeoProxyResult | null> {
  try {
    const response = await got(`${SELF}/api/public/sites/${projectId}/${file}`, {
      headers: internalRequestHeaders(),
      retry: { limit: 0 },
      throwHttpErrors: false,
    });
    if (!response.ok) return { ok: false, status: response.statusCode };
    let body = response.body;
    if (origin) {
      body = body
        .replace(new RegExp(`https?://[^/]+/sites/${projectId}`, 'g'), origin)
        // robots.txt points at the API-served sitemap; on a domain it lives at the root.
        .replace(new RegExp(`https?://[^/]+/api/public/sites/${projectId}/sitemap\\.xml`, 'g'), `${origin}/sitemap.xml`);
    }
    const headers = { 'content-type': SEO_CONTENT_TYPE[file] ?? 'text/plain; charset=utf-8', ...passThroughDocumentHeaders(response.headers) };
    return { ok: true, response: new Response(body, { status: 200, headers }) };
  } catch {
    return null;
  }
}

async function proxyPublishedMarkdown(projectId: string, path: string, search: URLSearchParams): Promise<SeoProxyResult | null> {
  try {
    const query = new URLSearchParams({ path });
    const language = search.get('lang');
    if (language) query.set('lang', language);
    const version = path.replace(/^\/+|\/+$/gu, '').split('/')[0];
    if (version) query.set('version', version);
    const response = await got(`${SELF}/api/public/sites/${projectId}/markdown?${query}`, {
      // The visitor's own credentials: a signed-in reader of a private site gets
      // the Markdown of pages they can read. The API decides cacheability (public
      // sites ignore credentials, so their Markdown stays shared-cacheable).
      headers: internalRequestHeaders(),
      retry: { limit: 0 },
      throwHttpErrors: false,
    });
    if (!response.ok) return { ok: false, status: response.statusCode };
    const headers = { 'content-type': 'text/markdown; charset=utf-8', ...passThroughDocumentHeaders(response.headers) };
    return { ok: true, response: new Response(response.body, { status: 200, headers }) };
  } catch {
    return null;
  }
}

const siteMarkdownUnavailableResponse = (origin: string): Response => {
  const response = new Response(
    `# Page not found\n\nThe requested page has no public Markdown representation. Recover from [llms.txt](${origin}/llms.txt).\n`,
    {
      status: 404,
      headers: {
        // Whether a page has Markdown can depend on who asks (a private site's readers).
        'cache-control': 'private, no-store',
        'content-type': 'text/markdown; charset=utf-8',
        'x-robots-tag': 'noindex, nofollow',
      },
    },
  );
  appendVary(response.headers, 'Accept');
  return response;
};

const addMarkdownDiscovery = (response: Response, canonicalUrl: string, llmsUrl: string): Response => {
  const decorated = new Response(response.body, response);
  decorated.headers.set('Link', markdownDiscoveryLinkHeader(canonicalUrl, llmsUrl));
  appendVary(decorated.headers, 'Accept');
  if (decorated.headers.get('content-type')?.startsWith('text/markdown')) {
    decorated.headers.set('Content-Location', markdownAlternateUrl(canonicalUrl));
  }
  return decorated;
};

/** Reads and removes the page route's internal Markdown-eligibility flag so it
 *  never reaches the reader. */
const withoutMarkdownAlternateFlag = (response: Response): { response: Response; markdownAlternate: boolean } => {
  const flag = response.headers.get(SITE_MARKDOWN_ALTERNATE_HEADER);
  if (flag === null) return { response, markdownAlternate: false };
  const stripped = new Response(response.body, response);
  stripped.headers.delete(SITE_MARKDOWN_ALTERNATE_HEADER);
  return { response: stripped, markdownAlternate: flag === '1' };
};

const llmsUrlForBase = (base: string): string => `${base.replace(/\/+$/u, '')}/llms.txt`;

/** Response for a site whose SEO doc the API refused (private/unpublished/taken
 *  down) or could not deliver (unreachable). We cannot prove the site is public,
 *  so robots.txt gets a restrictive `Disallow: /` (never the permissive
 *  allow-all fallback) and the other machine files 404 — they must not fall
 *  through to the SPA shell and render HTML as sitemap.xml/llms.txt. */
function seoUnavailableResponse(file: string): Response {
  if (file === 'robots.txt') {
    return new Response('User-agent: *\nDisallow: /\n', {
      headers: {
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  }
  // Whether this answer is a 404 can depend on the visitor's session (a private
  // site's files exist for its readers), so it must never enter a shared cache.
  return new Response('Not found', {
    status: 404,
    headers: { 'cache-control': 'private, no-store', 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex, nofollow' },
  });
}

/** Serve robots.txt / sitemap.xml / llms(-full).txt at a custom domain's ROOT,
 *  with URLs rebased from the internal /sites/:id form to the domain root. When
 *  the API refuses (private site) or is unreachable, serves the restrictive
 *  fallback rather than inviting crawlers or leaking the SPA shell. */
async function serveDomainSeo(pathname: string, projectId: string, origin: string): Promise<Response> {
  const file = pathname.slice(1);
  const proxied = await proxySeoDocument(projectId, file, origin);
  if (proxied?.ok) {
    return proxied.response;
  }
  return seoUnavailableResponse(file);
}

/** Proxy an app-origin GET /sites/:id/{robots.txt,sitemap.xml,llms.txt,
 *  llms-full.txt} to the API's public endpoint. These paths are in SKIP (so the
 *  custom-domain rewrite leaves them alone) and would otherwise fall through to
 *  the SPA shell — make them discoverable on the app origin too. */
async function serveAppOriginSeo(pathname: string): Promise<Response | null> {
  const match = APP_SEO_FILE.exec(pathname);
  if (!match) {
    return null;
  }
  const [, projectId, file] = match;
  if (!projectId || !file) {
    return null;
  }
  const proxied = await proxySeoDocument(projectId, file);
  if (proxied?.ok) {
    return proxied.response;
  }
  // Private/unpublished/unreachable — keep these out of the SPA fall-through the
  // same way the custom-domain path does (restrictive robots.txt, else 404).
  return seoUnavailableResponse(file);
}

// ─── App-origin root SEO docs (marketing vs self-hosted dashboard) ────────────
// The four /robots.txt, /sitemap.xml, /llms.txt, /llms-full.txt files at the app
// root are generated here (there is no static public/ copy) so that:
//  - the cloud marketing site (nibleaf.com) serves the full marketing documents,
//    with absolute URLs built from the request origin, and
//  - every OTHER origin (a self-hoster's dashboard) serves only a minimal
//    robots.txt keeping crawlers off the app surfaces, and 404s the marketing
//    sitemap/llms — a self-hoster must never advertise as "Nibleaf Cloud".

/** Minimal robots.txt for a self-hosted dashboard: no Sitemap line, no marketing
 *  docs, just keep crawlers out of the app/auth/api surfaces. (`/app$` catches the
 *  bare dashboard path without also matching e.g. /apple-touch-icon.png.) */
const SELF_HOST_ROBOTS = 'User-agent: *\nDisallow: /app/\nDisallow: /app$\nDisallow: /sign-in\nDisallow: /sign-up\nDisallow: /api/\n';

/** Full marketing robots.txt: allow crawling, disallow the app/auth/api
 *  surfaces (incl. token-bearing auth utility pages), and point at the sitemap. */
function marketingRobots(origin: string): string {
  return [
    'User-agent: OAI-SearchBot',
    'Allow: /',
    'Disallow: /app/',
    'Disallow: /api/',
    '',
    'User-agent: *',
    'Allow: /',
    'Disallow: /app/',
    'Disallow: /app$',
    'Disallow: /sign-in',
    'Disallow: /sign-up',
    'Disallow: /accept-invite',
    'Disallow: /forgot-password',
    'Disallow: /reset-password',
    'Disallow: /verify-email',
    'Disallow: /api/',
    'Disallow: /cdn-cgi/',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

/** Serve the four SEO docs at the APP origin's root. On the cloud marketing
 *  origin the full marketing documents (URLs built from the request origin); on
 *  any other origin a minimal robots.txt, with the marketing-only files 404ed. */
function serveRootSeo(pathname: string, host: string, bare: string, request: Request): Response | null {
  if (pathname === '/.well-known/security.txt') {
    const isMarketing = IS_CLOUD_MARKETING && (bare === MARKETING_HOST || host === MARKETING_HOST);
    if (!isMarketing) {
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    const origin = `${proto}://${host}`;
    const expires = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
    const body = [
      'Contact: mailto:security@nibleaf.com',
      `Expires: ${expires}`,
      `Canonical: ${origin}/.well-known/security.txt`,
      'Policy: mailto:security@nibleaf.com',
      'Preferred-Languages: en, ar',
      '',
    ].join('\n');
    return new Response(body, {
      status: 200,
      headers: {
        'cache-control': 'public, max-age=86400',
        'content-type': 'text/plain; charset=utf-8',
      },
    });
  }
  const isMarketingMachineFile = pathname === '/pricing.md' || pathname === '/openapi.json';
  if (!DOMAIN_SEO_FILE.test(pathname) && !isMarketingMachineFile) {
    return null;
  }
  const file = pathname.slice(1);
  const isMarketing = IS_CLOUD_MARKETING && (bare === MARKETING_HOST || host === MARKETING_HOST);
  if (!isMarketing) {
    if (file === 'robots.txt') {
      return new Response(SELF_HOST_ROBOTS, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const origin = `${proto}://${host}`;
  const body =
    file === 'openapi.json'
      ? `${JSON.stringify(nibleafPublicOpenApi(origin), null, 2)}\n`
      : file === 'pricing.md'
        ? marketingPricingMarkdown(origin)
        : file === 'robots.txt'
          ? marketingRobots(origin)
          : file === 'sitemap.xml'
            ? marketingSitemap(origin)
            : file === 'llms.txt'
              ? marketingLlms(origin)
              : marketingLlmsFull(origin);
  return new Response(body, {
    status: 200,
    headers: {
      'cache-control': 'public, max-age=300',
      'content-type': SEO_CONTENT_TYPE[file] ?? 'text/plain; charset=utf-8',
      ...(file === 'openapi.json' ? { 'content-disposition': 'inline; filename="openapi.json"', 'x-content-type-options': 'nosniff' } : {}),
    },
  });
}

const APP_SECURITY_HEADERS = {
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
} as const;

/** HTML rendered in the visitor's interface locale depends on the locale cookie
 *  and Accept-Language. It is already `private, no-store`; the Vary keeps any
 *  cache that ignores that from serving it to a visitor in another language. */
const varyOnInterfaceLocale = (headers: Headers): void => {
  appendVary(headers, 'Cookie');
  appendVary(headers, 'Accept-Language');
};

/** Custom server responses bypass Nitro route rules, so apply the same baseline
 *  here as a final wrapper. Preserve any stricter route-specific value. */
async function withSecurityHeaders(response: Response | Promise<Response>, nonce: string, localized: boolean): Promise<Response> {
  const res = await response;
  try {
    res.headers.set('x-nibleaf-revision', REVISION);
    for (const [name, value] of Object.entries(APP_SECURITY_HEADERS)) {
      if (!res.headers.has(name)) {
        res.headers.set(name, value);
      }
    }
    if ((res.headers.get('content-type') || '').includes('text/html')) {
      if (res.status === 404 && !res.headers.has('X-Robots-Tag')) {
        res.headers.set('X-Robots-Tag', 'noindex, nofollow');
      }
      res.headers.set('Content-Security-Policy', contentSecurityPolicy(nonce));
      if (nonce === '') return marketingHashResponse(encodePublicRouteManifestResponse(res));
      // A CSP nonce must be unique each time the policy is transmitted. Never
      // allow an intermediary to replay HTML and its nonce from a shared cache.
      res.headers.set('cache-control', 'private, no-store');
      if (localized) varyOnInterfaceLocale(res.headers);
      return encodePublicRouteManifestResponse(res);
    }
    return res;
  } catch {
    const wrapped = new Response(res.body, res);
    wrapped.headers.set('x-nibleaf-revision', REVISION);
    for (const [name, value] of Object.entries(APP_SECURITY_HEADERS)) {
      if (!wrapped.headers.has(name)) {
        wrapped.headers.set(name, value);
      }
    }
    if ((wrapped.headers.get('content-type') || '').includes('text/html')) {
      if (wrapped.status === 404 && !wrapped.headers.has('X-Robots-Tag')) {
        wrapped.headers.set('X-Robots-Tag', 'noindex, nofollow');
      }
      wrapped.headers.set('Content-Security-Policy', contentSecurityPolicy(nonce));
      if (nonce === '') return marketingHashResponse(encodePublicRouteManifestResponse(wrapped));
      wrapped.headers.set('cache-control', 'private, no-store');
      if (localized) varyOnInterfaceLocale(wrapped.headers);
      return encodePublicRouteManifestResponse(wrapped);
    }
    return wrapped;
  }
}

// ─── Request handling ─────────────────────────────────────────────────────────

/** Strip the body for HEAD requests — Node's http server does not do it for us,
 *  and crawlers routinely probe sitemap/llms URLs with HEAD before fetching. */
function withoutHeadBody(response: Response, method: string): Response {
  return method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
}

/** Drop any client-sent `x-nibleaf-site-origin`; only the custom-domain rewrite may set it. */
function withoutClientSiteOrigin(request: Request): Request {
  if (!request.headers.has('x-nibleaf-site-origin')) return request;
  const sanitized = new Request(request.url, request);
  sanitized.headers.delete('x-nibleaf-site-origin');
  return sanitized;
}

const handleRequestInner: RequestHandler<Register> = async (incoming, ...rest) => {
  const request = withoutClientSiteOrigin(incoming);
  const url = new URL(request.url);
  const host = effectiveRequestHost(request, url);
  const bare = host.split(':')[0] ?? '';
  const isCustomDomain = Boolean(host) && !ownHosts.has(host) && !ownHosts.has(bare);
  // Consolidate the marketing origin: www.nibleaf.com would otherwise resolve as
  // an unknown custom domain and serve duplicate 200 content on every path.
  if (IS_CLOUD_MARKETING && bare === `www.${MARKETING_HOST}`) {
    return Response.redirect(`https://${MARKETING_HOST}${url.pathname}${url.search}`, 301);
  }
  const isGetLike = request.method === 'GET' || request.method === 'HEAD';
  // Normalize trailing slashes permanently (/pricing/ → /pricing) — the router
  // would otherwise answer with a temporary 307, which never consolidates link
  // equity. Root '/' and the machine files are unaffected; 308 preserves method.
  if (isGetLike && url.pathname.length > 1 && url.pathname.endsWith('/')) {
    // Fall back to the request's own scheme so a proxy-less self-host on plain
    // http does not get bounced onto an https URL it never served.
    const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '') || 'https';
    return Response.redirect(`${proto}://${host}${url.pathname.replace(/\/+$/, '')}${url.search}`, 308);
  }

  // Stable `.md` aliases render the same published/marketing document as the
  // canonical HTML path. `/pricing.md` remains its dedicated product artifact.
  // The path as the reader asked for it, before the alias below rewrites it:
  // a redirect keeps the representation they asked for (`/guide.md` stays `.md`).
  const requestedPathname = url.pathname;
  const markdownAliasCanonical = isGetLike && url.pathname !== '/pricing.md' ? canonicalPathFromMarkdownAlias(url.pathname) : null;
  let routedRequest = request;
  if (markdownAliasCanonical) {
    url.pathname = markdownAliasCanonical;
    routedRequest = new Request(url, request);
    routedRequest.headers.set('accept', 'text/markdown');
    routedRequest.headers.set('x-nibleaf-markdown-alias', '1');
  }

  const isMarketingOrigin = IS_CLOUD_MARKETING && (bare === MARKETING_HOST || host === MARKETING_HOST);
  const marketingMarkdownPaths = new Set(marketingSitemapEntries().map((entry) => entry.path));
  const renderHtml = async (documentRequest: Request): Promise<Response> => {
    const documentUrl = new URL(documentRequest.url);
    if (!(isGetLike && isDocumentPath(documentUrl.pathname))) return startHandler(documentRequest, ...rest);

    const preferred = preferredRepresentation(documentRequest.headers.get('accept'));
    if (!preferred) return notAcceptableHtmlResponse();

    if (!isMarketingOrigin) {
      const siteMatch = /^\/sites\/([^/]+)(\/.*)?$/.exec(documentUrl.pathname);
      if (preferred === 'text/markdown') {
        if (!siteMatch?.[1]) return notAcceptableHtmlResponse();
        const projectId = siteMatch[1];
        const routedPath = siteMatch[2] || '/';
        const publicPath = decodePublishedPathname(routedPath);
        const requestOrigin = documentRequest.headers.get('x-nibleaf-site-origin');
        const meta = await resolveSiteMeta(projectId);
        const base = meta?.primaryDomain
          ? `https://${meta.primaryDomain}`
          : requestOrigin
            ? requestOrigin
            : `${documentUrl.origin}/sites/${projectId}`;
        if (publicPath === null) return siteMarkdownUnavailableResponse(base);
        const parsed = parseSiteLanguagePath(publicPath, meta?.languages ?? []);
        const search = new URLSearchParams(documentUrl.searchParams);
        if (parsed.language) search.set('lang', parsed.language.code);
        const proxied = await proxyPublishedMarkdown(projectId, parsed.path, search);
        if (!proxied?.ok) return siteMarkdownUnavailableResponse(base);
        const canonicalUrl = documentUrlForBase(base, routedPath, documentUrl.search);
        return withoutHeadBody(addMarkdownDiscovery(proxied.response, canonicalUrl, llmsUrlForBase(base)), documentRequest.method);
      }
      if (!acceptsHtml(documentRequest.headers.get('accept'))) return notAcceptableHtmlResponse();
      const rendered = withoutMarkdownAlternateFlag(await startHandler(documentRequest, ...rest));
      if (rendered.response.status >= 400 || !siteMatch?.[1]) return rendered.response;
      // The page route already loaded the page and applied the shared
      // eligibility rule (isPublicMarkdownPage); it flags the SSR response, so
      // the HTML never waits on a second, full Markdown render just to decide
      // this header.
      if (!rendered.markdownAlternate) return rendered.response;
      const meta = await resolveSiteMeta(siteMatch[1]);
      if (!meta || meta.isPrivate) return rendered.response;
      const requestOrigin = documentRequest.headers.get('x-nibleaf-site-origin');
      const base = meta.primaryDomain
        ? `https://${meta.primaryDomain}`
        : requestOrigin
          ? requestOrigin
          : `${documentUrl.origin}/sites/${siteMatch[1]}`;
      const routedPath = siteMatch[2] || '/';
      if (decodePublishedPathname(routedPath) === null) return rendered.response;
      const canonicalUrl = documentUrlForBase(base, routedPath, documentUrl.search);
      return addMarkdownDiscovery(rendered.response, canonicalUrl, llmsUrlForBase(base));
    }

    const isMarkdownCandidate = marketingMarkdownPaths.has(documentUrl.pathname);
    if (preferred === 'text/markdown' && documentUrl.pathname === '/pricing') {
      const protocol = documentRequest.headers.get('x-forwarded-proto') || documentUrl.protocol.replace(':', '') || 'https';
      const origin = `${protocol}://${documentUrl.host}`;
      const response = new Response(marketingPricingMarkdown(origin), {
        headers: { 'cache-control': 'public, max-age=300', 'content-type': 'text/markdown; charset=utf-8' },
      });
      return withoutHeadBody(addMarkdownDiscovery(response, `${origin}/pricing`, `${origin}/llms.txt`), documentRequest.method);
    }
    const renderRequest = preferred === 'text/markdown' ? asHtmlRenderRequest(documentRequest) : documentRequest;
    const rendered = await startHandler(renderRequest, ...rest);

    if (rendered.status === 404) {
      const response = preferred === 'text/markdown' ? agentFriendlyNotFoundMarkdown(documentUrl.origin) : new Response(rendered.body, rendered);
      appendVary(response.headers, 'Accept');
      return withoutHeadBody(response, documentRequest.method);
    }

    if (preferred === 'text/markdown') {
      if (!isMarkdownCandidate) {
        if (!acceptsHtml(documentRequest.headers.get('accept'))) return notAcceptableHtmlResponse();
        return rendered;
      }
      const markdown = await marketingMarkdownResponse(rendered, documentUrl.toString());
      return withoutHeadBody(
        addMarkdownDiscovery(markdown, documentUrl.toString(), new URL('/llms.txt', documentUrl.origin).toString()),
        documentRequest.method,
      );
    }

    const response = new Response(rendered.body, rendered);
    if (isMarkdownCandidate) {
      return addMarkdownDiscovery(response, documentUrl.toString(), new URL('/llms.txt', documentUrl.origin).toString());
    }
    return response;
  };

  const serve = async (): Promise<Response> => {
    if (isGetLike) {
      const match = /^\/sites\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
      const projectId = isCustomDomain && !isAppOwnedPath(url.pathname) ? await resolveHost(bare) : match?.[1];
      if (projectId && (isDocumentPath(url.pathname) || url.pathname.endsWith('/changelog/rss.xml'))) {
        const meta = await resolveSiteMeta(projectId);
        const path = isCustomDomain ? url.pathname.slice(1) : (match?.[2] ?? '');
        const target = legacySiteLanguageTarget({
          path,
          languages: meta?.languages ?? [],
          basePath: isCustomDomain ? '' : `/sites/${projectId}`,
          search: url.search,
        });
        if (target) {
          const migrated = new URL(target, url.origin);
          const location = markdownAliasCanonical ? `${markdownAliasPath(migrated.pathname)}${migrated.search}` : target;
          return new Response(null, { status: 308, headers: { location } });
        }
        const parsed = parseSiteLanguagePath(path, meta?.languages ?? []);
        if (parsed.language && parsed.path === 'changelog/rss.xml') {
          const base = isCustomDomain ? `${url.protocol}//${host}` : `${url.origin}/sites/${projectId}`;
          const proxied = await proxySeoDocument(projectId, 'changelog/rss.xml', `${base}/${encodeURIComponent(parsed.language.code)}`);
          return proxied?.ok ? withoutHeadBody(proxied.response, request.method) : seoUnavailableResponse('changelog/rss.xml');
        }
      }
    }

    // Binary OG cards share the API's public-only gate on both URL surfaces.
    if (isGetLike) {
      const card = (isCustomDomain ? /^\/og\/(.*\.png)$/u : /^\/sites\/([^/]+)\/og\/(.*\.png)$/u).exec(url.pathname);
      if (card) {
        const projectId = isCustomDomain ? await resolveHost(bare) : card[1];
        if (!projectId) return new Response(null, { status: 404, headers: { 'cache-control': 'private, no-store' } });
        const suffix = isCustomDomain ? card[1] : card[2];
        return proxySiteOg(SELF, projectId, suffix ?? '', request, internalRequestHeaders());
      }
    }
    if (!isCustomDomain) {
      if (isGetLike) {
        const artifact = serveSelfHostingArtifact(url.pathname, bare);
        if (artifact) {
          return withoutHeadBody(artifact, request.method);
        }
        // App-origin ROOT robots/sitemap/llms: the marketing docs on nibleaf.com,
        // a minimal robots.txt (and 404s) on every self-hosted dashboard.
        const rootSeo = serveRootSeo(url.pathname, host, bare, request);
        if (rootSeo) {
          return withoutHeadBody(rootSeo, request.method);
        }
        // App-origin robots/sitemap/llms for a site live under /sites/:id/*; serve
        // them from the API (they're in SKIP so they never reach the site routes).
        const seo = await serveAppOriginSeo(url.pathname);
        if (seo) {
          return withoutHeadBody(seo, request.method);
        }
      }
      if (request.method === 'GET') {
        const siteMatch = /^\/sites\/([^/]+)(\/.*)?$/.exec(url.pathname);
        // Never consolidate the machine files (robots/sitemap/llms) — they were
        // handled above; a transient proxy failure must not turn into a 301.
        if (siteMatch?.[1] && !APP_SEO_FILE.test(url.pathname)) {
          const meta = await resolveSiteMeta(siteMatch[1]);
          // Consolidate SEO equity: when a verified primary custom domain exists,
          // 301 the internal /sites/:id URL onto it. Loop-safe: on the primary
          // domain itself the request is a custom-domain request, not this branch.
          if (meta?.primaryDomain && meta.primaryDomain !== bare) {
            return Response.redirect(`https://${meta.primaryDomain}${siteMatch[2] || '/'}${url.search}`, 301);
          }
          // `/sites/<slug>`: the site's name in the address rather than its id
          // (what the dashboard showed before, and what people type). Send it to
          // the site; from there its primary domain, if any, takes over.
          if (!meta) {
            let slug = siteMatch[1];
            try {
              slug = decodeURIComponent(slug);
            } catch {
              // A malformed escape is looked up as written (and matches no slug).
            }
            const projectId = await resolveSiteSlug(slug.toLowerCase());
            if (projectId && projectId !== siteMatch[1]) {
              // Everything after the slug as the reader wrote it, `.md` included.
              const slugPrefix = `/sites/${siteMatch[1]}`;
              const suffix = requestedPathname.startsWith(slugPrefix) ? requestedPathname.slice(slugPrefix.length) : (siteMatch[2] ?? '');
              // Relative, so the browser keeps the scheme and host it used (behind a
              // TLS proxy the server's own URL may say otherwise). Not cached: a slug
              // can be renamed and then taken by another site.
              return new Response(null, {
                status: 301,
                headers: { location: `/sites/${projectId}${suffix}${url.search}`, 'cache-control': 'no-store' },
              });
            }
          }
          return renderHtml(routedRequest);
        }
      }
      return renderHtml(routedRequest);
    }

    // robots/sitemap/llms are served at the domain root (they are not in SKIP,
    // so they'd otherwise be rewritten to a nonexistent /sites/:id route).
    if (isGetLike && DOMAIN_SEO_FILE.test(url.pathname)) {
      const projectId = await resolveHost(bare);
      if (projectId) {
        const proto = request.headers.get('x-forwarded-proto') || 'https';
        // Always resolves to a Response (restrictive fallback for a private or
        // unreachable site) — never fall through to the /sites rewrite, which
        // would render the SPA shell as sitemap.xml/robots.txt.
        return withoutHeadBody(await serveDomainSeo(url.pathname, projectId, `${proto}://${host}`), request.method);
      }
    }
    if (isAppOwnedPath(url.pathname)) {
      return startHandler(routedRequest, ...rest);
    }
    if (!isAppOwnedPath(url.pathname)) {
      const projectId = await resolveHost(bare);
      if (projectId) {
        const meta = await resolveSiteMeta(projectId);
        // A secondary (non-primary) custom domain 301s onto the primary. Only
        // redirect when the hosts actually differ — never from the primary
        // itself, and never for the machine files handled above.
        if (request.method === 'GET' && meta?.primaryDomain && meta.primaryDomain !== bare && !DOMAIN_SEO_FILE.test(url.pathname)) {
          return Response.redirect(`https://${meta.primaryDomain}${url.pathname}${url.search}`, 301);
        }
        url.pathname = `/sites/${projectId}${url.pathname === '/' ? '' : url.pathname}`;
        // Stamp the real domain origin so the SSR head builds canonical/og/hreflang
        // against the custom domain root, not the internal /sites/:id origin.
        const rewritten = new Request(url, routedRequest);
        const proto = request.headers.get('x-forwarded-proto') || 'https';
        rewritten.headers.set('x-nibleaf-site-origin', `${proto}://${host}`);
        return renderHtml(rewritten);
      }
    }
    return new Response('Published site not found.\n', {
      status: 404,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
        'x-content-type-options': 'nosniff',
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  };

  // Run inside the visitor-IP context so SSR loader fetches are attributed to
  // the real client (see the fetch patch above).
  const requestAuth: PublishedRequestAuth = {
    ip: clientIpFromForwardedFor(request.headers.get('x-forwarded-for'), serverEnv.TRUSTED_PROXY_HOPS),
    cookie: request.headers.get('cookie'),
    authorization: request.headers.get('authorization'),
    userAgent: request.headers.get('user-agent') ?? undefined,
  };
  return publishedRequestAuth.run(requestAuth, serve);
};

const crawlerProjectForRequest = async (request: Request): Promise<string | null> => {
  const url = new URL(request.url);
  const host = effectiveRequestHost(request, url);
  const bare = host.split(':')[0] ?? '';
  const ownOrigin = ownHosts.has(host) || ownHosts.has(bare);
  const site = /^\/sites\/([^/]+)(?:\/|$)/u.exec(url.pathname);
  if (ownOrigin) return site?.[1] ?? null;
  if (isAppOwnedPath(url.pathname) && !DOMAIN_SEO_FILE.test(url.pathname)) return null;
  return resolveHost(bare);
};

/** A marketing page, or its Markdown alias. Its language comes from the URL
 *  (/ar), and its HTML and Markdown are shared-cached. */
const MARKETING_DOCUMENT_PATHS = new Set(marketingSitemapEntries().map((entry) => entry.path));
const isMarketingDocumentPath = (pathname: string): boolean => MARKETING_DOCUMENT_PATHS.has(canonicalPathFromMarkdownAlias(pathname) ?? pathname);

/** A published reader document: any page on a custom domain, or /sites/:id on
 *  the dashboard origin. It renders in each page's own language (#474, #481). */
const isPublishedReaderRequest = (request: Request, url: URL): boolean => {
  const host = effectiveRequestHost(request, url);
  const bare = host.split(':')[0] ?? '';
  if (ownHosts.has(host) || ownHosts.has(bare)) return /^\/sites\/[^/]/u.test(url.pathname);
  return true;
};

const handleRequest: RequestHandler<Register> = async (request, ...rest) => {
  if (new URL(request.url).pathname === '/health') {
    if (existsSync(DRAIN_FILE)) {
      return Response.json(
        { status: 'shutting_down', service: 'app', revision: REVISION },
        { status: 503, headers: { 'cache-control': 'no-store', 'x-nibleaf-revision': REVISION } },
      );
    }
    try {
      const upstream = await got(`${SELF}/api/app/health`, { retry: { limit: 0 }, throwHttpErrors: false, timeout: { request: 5000 } });
      const ready = upstream.statusCode === 200;
      return Response.json(
        { status: ready ? 'ok' : 'unavailable', service: 'app', revision: REVISION },
        { status: ready ? 200 : 503, headers: { 'cache-control': 'no-store', 'x-nibleaf-revision': REVISION } },
      );
    } catch {
      return Response.json(
        { status: 'unavailable', service: 'app', revision: REVISION },
        { status: 503, headers: { 'cache-control': 'no-store', 'x-nibleaf-revision': REVISION } },
      );
    }
  }
  const url = new URL(request.url);
  // Allowlisted cloud marketing documents only. Conservatively bypass all
  // cookies, Authorization and query strings, as the CDN rule must also do.
  const marketing =
    IS_CLOUD_MARKETING &&
    effectiveRequestHost(request, url).split(':')[0] === MARKETING_HOST &&
    ['GET', 'HEAD'].includes(request.method) &&
    !url.search &&
    !request.headers.has('cookie') &&
    !request.headers.has('authorization') &&
    acceptsHtml(request.headers.get('accept')) &&
    marketingSitemapEntries().some((entry) => entry.path === url.pathname);
  const nonce = marketing ? '' : randomBytes(18).toString('base64');
  const renderRequest = marketing && request.method === 'HEAD' ? new Request(request.url, { method: 'GET', headers: request.headers }) : request;
  // Product pages (auth, dashboard, invitations) render in the visitor's
  // interface language: the locale cookie, then Accept-Language, as the browser
  // resolves it, so hydration never switches language or direction. The locale
  // is scoped to this request. Marketing pages take their language from the URL
  // and are shared-cached, and a published reader renders each page's own
  // language, so both keep the base locale, as before.
  const interfaceLocale = isMarketingDocumentPath(url.pathname) || isPublishedReaderRequest(request, url) ? null : requestInterfaceLocale(request);
  const respond = () =>
    ssrNonce.run(nonce, async () =>
      withoutHeadBody(
        await withSecurityHeaders(
          observeCrawlerResponse(
            request,
            // The page route's internal Markdown flag never leaves the server,
            // whichever path rendered the page (cloud origin, dotted paths, …).
            Promise.resolve(handleRequestInner(renderRequest, ...rest)).then((response) => withoutMarkdownAlternateFlag(response).response),
            crawlerProjectForRequest,
          ),
          nonce,
          interfaceLocale !== null,
        ),
        request.method,
      ),
    );
  return interfaceLocale ? withInterfaceLocale(interfaceLocale, url.origin, respond) : respond();
};

export default createServerEntry({ fetch: handleRequest });
