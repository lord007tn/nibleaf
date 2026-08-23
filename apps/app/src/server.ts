import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Register } from '@tanstack/react-router';
import { createStartHandler, defaultStreamHandler, type RequestHandler } from '@tanstack/react-start/server';
import { serverEnv } from '@/env.server';
import { BLOG_ENTRIES } from '@/lib/blog';
import { nibleafPricing, nibleafProductLimitations } from '@/lib/comparison-data';
import { contentSecurityPolicy } from '@/lib/content-security-policy';
import { agentFriendlyNotFoundMarkdown, marketingMarkdownResponse } from '@/lib/marketing-markdown';
import { marketingSitemap, marketingSitemapEntries } from '@/lib/marketing-sitemap';
import { nibleafPublicOpenApi } from '@/lib/nibleaf-openapi';
import {
  acceptsHtml,
  appendVary,
  asHtmlRenderRequest,
  isDocumentPath,
  notAcceptableHtmlResponse,
  preferredRepresentation,
} from '@/lib/request-negotiation';
import { renderSelfHostInstaller } from '@/lib/self-host-release';
import PRODUCTION_COMPOSE from '../../../docker-compose.prod.yml?raw';
import INSTALL_SCRIPT from '../../../scripts/install.sh?raw';

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

const ssrNonce = new AsyncLocalStorage<string>();

const startHandler = createStartHandler((context) => {
  const nonce = ssrNonce.getStore();
  if (nonce) {
    context.router.update({ ssr: { ...context.router.options.ssr, nonce } });
  }
  return defaultStreamHandler(context);
});

// Reach the API through the app's own same-origin /api proxy — this is the path
// that works both in the container (where the server is a separate host) and in
// dev, matching how the SSR data loaders fetch.
const SELF = `http://localhost:${serverEnv.PORT}`;

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
const SKIP = /^\/(api|_|assets|favicon|sites)\b/;

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

// Compact copies of apps/server/src/lib/client-ip.ts (kept in sync manually —
// this entry can't import from the server package).
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6 = /^[0-9a-f:]+$/i;

const normalizeIp = (raw: string): string => {
  let value = raw.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed?.[1]) {
    value = bracketed[1];
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(value)) {
    value = value.slice(0, value.lastIndexOf(':'));
  }
  const zone = value.indexOf('%');
  return zone === -1 ? value : value.slice(0, zone);
};

const isValidIp = (value: string): boolean => {
  const v4 = IPV4.exec(value);
  if (v4) {
    return v4.slice(1).every((octet) => Number(octet) <= 255);
  }
  return value.includes(':') && IPV6.test(value);
};

const isPrivateIp = (ip: string): boolean => {
  const value = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const v4 = IPV4.exec(value);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80');
};

/** Public edge hops appended by infrastructure the operator runs (e.g. 1 behind
 *  Cloudflare). Must match the API's TRUSTED_PROXY_HOPS. */
const TRUSTED_PROXY_HOPS = serverEnv.TRUSTED_PROXY_HOPS;

/** Rightmost-untrusted hop of an x-forwarded-for chain — mirrors the API's
 *  apps/server/src/lib/client-ip.ts (kept in sync manually; this entry cannot
 *  import from the server package). Leftmost hops are client-supplied because
 *  proxies APPEND, so trusting them would let a visitor forge a new identity
 *  per request. */
const clientIpFromForwardedFor = (header: string | null): string | null => {
  if (!header) {
    return null;
  }
  const hops = header
    .split(',')
    .map((hop) => normalizeIp(hop))
    .filter((hop) => hop.length > 0 && hop !== 'unknown' && isValidIp(hop));
  if (hops.length === 0) {
    return null;
  }
  const candidates = TRUSTED_PROXY_HOPS > 0 ? hops.slice(0, Math.max(1, hops.length - TRUSTED_PROXY_HOPS)) : hops;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const hop = candidates[i] as string;
    if (!isPrivateIp(hop)) {
      return hop;
    }
  }
  return (candidates[candidates.length - 1] as string) ?? null;
};

interface PublishedRequestAuth {
  ip: string | null;
  cookie: string | null;
  authorization: string | null;
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
      if (requestAuth.ip && INTERNAL_API_SECRET) {
        headers.set('x-nibleaf-internal', INTERNAL_API_SECRET);
      }
      // SSR loaders and edge metadata/SEO fetches must make the same access
      // decision as the browser request. Forward only credentials, never the
      // full inbound header bag.
      if (requestAuth.cookie) headers.set('cookie', requestAuth.cookie);
      if (requestAuth.authorization) headers.set('authorization', requestAuth.authorization);
      return baseFetch(input, { ...init, headers });
    }
  }
  return baseFetch(input, init);
}) as typeof fetch;

// ─── Custom-domain host → project resolution ─────────────────────────────────

const cache = new Map<string, { projectId: string | null; at: number }>();
const TTL = 30_000;

async function resolveHost(host: string): Promise<string | null> {
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL) {
    return hit.projectId;
  }
  try {
    const res = await fetch(`${SELF}/api/public/domains/resolve?host=${encodeURIComponent(host)}`);
    const json = (await res.json()) as { data?: { projectId?: string | null } };
    const projectId = json?.data?.projectId ?? null;
    cache.set(host, { projectId, at: Date.now() });
    return projectId;
  } catch {
    return null;
  }
}

// ─── Published-site metadata (privacy + primary domain) ──────────────────────

/** What the edge needs to know about a published site: whether its HTML may be
 *  shared-cached, and which host is its canonical (primary) home. */
interface SiteMeta {
  /** Verified primary custom domain, when configured. */
  primaryDomain: string | null;
  isPrivate: boolean;
}

const siteMetaCache = new Map<string, { meta: SiteMeta | null; at: number }>();
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
  let meta: SiteMeta | null = null;
  try {
    const res = await fetch(`${SELF}/api/public/sites/${projectId}`);
    if (res.ok) {
      const json = (await res.json()) as {
        data?: { project?: { config?: Record<string, unknown> | null; primaryDomain: string | null } };
      };
      const project = json?.data?.project;
      if (project) {
        const primary = typeof project.primaryDomain === 'string' ? project.primaryDomain.trim().toLowerCase() : '';
        meta = {
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
  let res: Response;
  try {
    res = await fetch(`${SELF}/api/public/sites/${projectId}/${file}`);
  } catch {
    return null;
  }
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  let body: string;
  try {
    body = await res.text();
  } catch {
    return null;
  }
  if (origin) {
    body = body
      .replace(new RegExp(`https?://[^/]+/sites/${projectId}`, 'g'), origin)
      // robots.txt points at the API-served sitemap; on a domain it lives at the root.
      .replace(new RegExp(`https?://[^/]+/api/public/sites/${projectId}/sitemap\\.xml`, 'g'), `${origin}/sitemap.xml`);
  }
  const headers: Record<string, string> = { 'content-type': SEO_CONTENT_TYPE[file] ?? 'text/plain; charset=utf-8' };
  const cacheControl = res.headers.get('cache-control');
  if (cacheControl) {
    headers['cache-control'] = cacheControl;
  }
  return { ok: true, response: new Response(body, { status: 200, headers }) };
}

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
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
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

function marketingLlms(origin: string): string {
  return `# Nibleaf

> Nibleaf is a documentation platform with a visual Markdown editor, versioned publishing, built-in search, Arabic/RTL support, custom domains, and a free cloud beta at nibleaf.com.

Last reviewed: 2026-08-22

## Key facts

- Public AGPL-3.0 source repository with an anonymously accessible pinned GHCR container release
- Guided Docker Compose installer for the app, API, worker, database, cache, and object storage
- Notion-style WYSIWYG editor over plain Markdown/MDX - content round-trips losslessly, no proprietary format
- First-class Arabic and English authoring with full right-to-left (RTL) support, per-language page trees, and hreflang
- Versioned publishing: every publish is an immutable snapshot, rollback is atomic
- Built-in full-text + fuzzy search (Orama), bilingual including an Arabic tokenizer - no external search service
- Custom-domain and project-subdomain workflows are active; operators must still verify their own DNS and TLS configuration
- First-party reader analytics (page views, top pages, top searches); the hosted service also uses Cloudflare for delivery, security, and web analytics
- Works with any S3-compatible storage (AWS S3, Cloudflare R2, Backblaze B2, or the bundled storage service)
- Nibleaf Cloud (nibleaf.com) is a managed instance, free while in beta

## Pages

- [Home](${origin}/): overview and features
- [Arabic home](${origin}/ar): Arabic product overview and RTL-first workflow
- [Documentation platforms for Arabic teams](${origin}/ar/documentation-platforms): source-backed Arabic buyer guide
- [Nibleaf Cloud](${origin}/cloud): hosted documentation sites, free during beta
- [Pricing](${origin}/pricing): free cloud beta and self-hosting requirements
- [Self-hosting](${origin}/self-hosting): guided installer and deployment architecture
- [About](${origin}/about): mission and stack
- [Contact](${origin}/contact): product support, privacy, security, abuse, and editorial corrections
- [Nibleaf developer resources](${origin}/developers): public API contract, agent access, authentication boundaries, and CLI status
- [RTL documentation readiness grader](${origin}/tools/rtl-documentation-readiness): browser-only static HTML checks with transparent unknowns
- [Nibleaf vs Mintlify](${origin}/compare/nibleaf-vs-mintlify)
- [Nibleaf vs GitBook](${origin}/compare/nibleaf-vs-gitbook)
- [Nibleaf vs Docusaurus](${origin}/compare/nibleaf-vs-docusaurus)
- [Mintlify alternatives](${origin}/alternatives/mintlify)
- [GitBook alternatives](${origin}/alternatives/gitbook)
- [ReadMe alternatives](${origin}/alternatives/readme)
- [Terms of Service](${origin}/terms)
- [Privacy Policy](${origin}/privacy)

## Product truth and source

- [Public source repository](https://github.com/lord007tn/nibleaf): AGPL-3.0 code, issues, releases, and implementation details
- [Product documentation](https://docs.nibleaf.com): current public user and operator documentation
- [Machine-readable pricing](${origin}/pricing.md): current plans, limits, and operational responsibilities
- [Nibleaf public OpenAPI specification](${origin}/openapi.json): typed public reader endpoints with unique operation IDs
- [Security contact](${origin}/.well-known/security.txt): supported disclosure channel

## When to use Nibleaf

Use Nibleaf when a team needs to author, publish, search, or self-host versioned Markdown documentation, especially for bilingual English/Arabic sites, right-to-left interfaces, portable MDX content, or immutable release snapshots. Do not use Nibleaf as a general-purpose CMS, transactional database, or hosted write API: the supported developer contract currently covers public read access only.

## How agents should call Nibleaf

1. Read this file for product routing, then use [llms-full.txt](${origin}/llms-full.txt) when the complete product description is needed.
2. Request a human-facing Nibleaf URL with \`Accept: text/markdown\` for its clean Markdown representation.
3. Read [openapi.json](${origin}/openapi.json) before calling public reader endpoints. Use the \`siteId\` from a published site's URL and do not assume dashboard session endpoints are a supported write API.
4. For a published documentation site, prefer its own \`/llms.txt\`, \`/llms-full.txt\`, \`/sitemap.xml\`, and, when configured by that site owner, \`/openapi.json\`.
5. If a path returns 404, follow the sitemap or llms index instead of guessing paths.

## Current limitations

- No paid Nibleaf Cloud plan is offered while the service is in beta.
${nibleafProductLimitations.map((limitation) => `- ${limitation}`).join('\n')}
- GitHub has a two-way authoring workflow; public GitLab and generic Git imports are currently one-way.

## Blog

${BLOG_ENTRIES.map((entry) => `- [${entry.title}](${origin}/blog/${entry.slug}): ${entry.description}`).join('\n')}

## Full details

- [llms-full.txt](${origin}/llms-full.txt): complete plain-text product description
`;
}

function marketingLlmsFull(origin: string): string {
  return `# Nibleaf - full description

Nibleaf is a documentation platform with a visual Markdown editor, versioned publishing, built-in search, Arabic/RTL support, custom domains, and a free cloud beta at nibleaf.com.

Nibleaf lets teams write documentation in Markdown/MDX, organize it into a navigable tree, and publish a searchable, multilingual site with versioned deploys, per-site teams, custom domains, and analytics. The managed cloud at nibleaf.com is free while in beta.

## What is Nibleaf?

Nibleaf combines a browser editor, Markdown content, publishing, search, analytics, and multilingual reader sites. Pages are stored as Markdown in the database and can be exported as Markdown, so the content format is portable even though the live source is not a Git directory.

Nibleaf was built with English and Arabic authoring as core features, including right-to-left layout and per-language page trees.

## Features

- Rich editor: WYSIWYG and raw Markdown/MDX modes with live preview, a Notion-style block handle and slash menu, and a drag-and-drop, nestable page tree.
- MDX components: callouts, cards, steps, tabs, code groups, accordions, param/response fields, frames, tooltips, inline icons, KaTeX math, and Mermaid diagrams - all round-trip losslessly between visual and source modes.
- Versioned publishing: every publish is an immutable snapshot with atomic roll-forward; readers never see a half-written page.
- Branches: git-style, database-backed branches - fork, edit in isolation, and merge into main.
- Anchored comments: review comments pinned to the exact block, Figma-style.
- Hybrid search: full-text + fuzzy search powered by Orama, bilingual (including an Arabic tokenizer), built into every published site and available via Cmd+K. No external search service.
- Bilingual and RTL: per-language page trees, RTL layout, hreflang, and localized dashboard/editor/site chrome in English and Arabic.
- Custom domains and subdomains: guided DNS setup and verification plus host-based published-site routing. Production DNS readiness depends on the configured domain and must be verified separately.
- SEO built in: server-side rendering, per-page canonical/Open Graph/Twitter/JSON-LD, sitemaps, robots controls, hreflang, and noindex controls.
- Per-site teams: each site is its own workspace with role-based members (owner/admin/editor).
- Analytics: first-party page views, unique visitors, top pages, top searches, plus device and language breakdowns. Nibleaf Cloud also uses Cloudflare for delivery, security, and web analytics.
- Bring-your-own storage: any S3-compatible store (AWS S3, Cloudflare R2, Backblaze B2, or the bundled storage service).

## Self-hosting

The codebase is licensed under AGPL-3.0. Its public repository, pinned GHCR release, guided installer, and production Docker Compose file are anonymously accessible. The stack contains the app, API, worker, PostgreSQL, cache, and object storage. Operators remain responsible for DNS, TLS, backups, monitoring, and restore testing; see ${origin}/self-hosting for the verified installation path and production checklist.

## Nibleaf Cloud

Nibleaf Cloud (${origin}) is the managed instance run by the Nibleaf team: hosted dashboard, managed database, queues and storage, automatic upgrades, custom domains, and analytics. It is free while in beta. No paid plan is currently offered.

## License

AGPL-3.0. The license governs your rights to use, copy, modify, and distribute the software, including the AGPL's network-use clause.

## Links

- Home: ${origin}/
- Arabic home: ${origin}/ar
- Arabic platform comparison: ${origin}/ar/documentation-platforms
- Cloud: ${origin}/cloud
- Pricing: ${origin}/pricing
- Machine-readable pricing: ${origin}/pricing.md
- Self-hosting: ${origin}/self-hosting
- Blog: ${origin}/blog
- About: ${origin}/about
- Developer resources: ${origin}/developers
- Nibleaf public OpenAPI specification: ${origin}/openapi.json
- Terms of Service: ${origin}/terms
- Privacy Policy: ${origin}/privacy
- Support: support@nibleaf.com
- RTL documentation readiness grader: ${origin}/tools/rtl-documentation-readiness
- Product documentation: https://docs.nibleaf.com
- Public source: https://github.com/lord007tn/nibleaf
`;
}

/** Stable, non-JavaScript pricing truth for search engines and software agents.
 * Keep this synchronized with /pricing and lib/comparison-data.ts. */
function marketingPricingMarkdown(origin: string): string {
  const cloud = nibleafPricing.rows.find((row) => row.plan === 'Cloud');
  const selfHosted = nibleafPricing.rows.find((row) => row.plan === 'Self-hosted');

  return `# Nibleaf pricing

Last reviewed: 2026-08-22

Nibleaf currently has no paid cloud plan. The managed cloud is free while in beta, and the self-hosted codebase is available under AGPL-3.0. No credit card is required to create a cloud account.

## Nibleaf Cloud beta

- Price: ${cloud?.price ?? 'Free while in beta'}
- Billing: no paid plan is currently offered
- Includes: ${cloud?.includes ?? 'Hosted dashboard and documentation sites, managed database and storage, custom domains, analytics, and search.'}
- Limits: fair-use controls apply; product limits can change during beta
- Sign up: ${origin}/sign-up

## Self-hosted Nibleaf

- Software price: ${selfHosted?.price ?? 'Free under AGPL-3.0'}
- Source: https://github.com/lord007tn/nibleaf
- Includes: ${selfHosted?.includes ?? 'App, API, worker, PostgreSQL, cache, object storage, installer, and production Docker Compose configuration.'}
- Operator responsibilities: infrastructure, DNS, TLS, secrets, backups, monitoring, upgrades, incident response, and restore testing
- Deployment guide: ${origin}/self-hosting

## Important limitations

- There is no committed date or price for a future paid cloud plan.
${nibleafProductLimitations.map((limitation) => `- ${limitation}`).join('\n')}
- Cloudflare processes traffic for delivery, security, and web analytics on the managed service.

## العربية

- سحابة Nibleaf مجانية خلال المرحلة التجريبية، ولا توجد خطة مدفوعة حاليًا.
- يمكن تشغيل المنظومة كاملة من المصدر العام بترخيص AGPL-3.0، مع تحمّل المشغّل مسؤولية البنية وDNS وTLS والنسخ الاحتياطي والمراقبة والترقيات.
- الصفحة العربية: ${origin}/ar

For the human-readable plan comparison and current policy details, see ${origin}/pricing.
`;
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

/** Custom server responses bypass Nitro route rules, so apply the same baseline
 *  here as a final wrapper. Preserve any stricter route-specific value. */
async function withSecurityHeaders(response: Response | Promise<Response>, nonce: string): Promise<Response> {
  const res = await response;
  try {
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
      // A CSP nonce must be unique each time the policy is transmitted. Never
      // allow an intermediary to replay HTML and its nonce from a shared cache.
      res.headers.set('cache-control', 'private, no-store');
    }
    return res;
  } catch {
    const wrapped = new Response(res.body, res);
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
      wrapped.headers.set('cache-control', 'private, no-store');
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

const handleRequestInner: RequestHandler<Register> = async (request, ...rest) => {
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

  const isMarketingOrigin = IS_CLOUD_MARKETING && (bare === MARKETING_HOST || host === MARKETING_HOST);
  const marketingMarkdownPaths = new Set(marketingSitemapEntries().map((entry) => entry.path));
  const renderHtml = async (documentRequest: Request): Promise<Response> => {
    const documentUrl = new URL(documentRequest.url);
    if (!(isGetLike && isDocumentPath(documentUrl.pathname))) return startHandler(documentRequest, ...rest);

    if (!isMarketingOrigin) {
      if (!acceptsHtml(documentRequest.headers.get('accept'))) return notAcceptableHtmlResponse();
      return startHandler(documentRequest, ...rest);
    }

    const preferred = preferredRepresentation(documentRequest.headers.get('accept'));
    if (!preferred) return notAcceptableHtmlResponse();

    const isMarkdownCandidate = marketingMarkdownPaths.has(documentUrl.pathname);
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
      return withoutHeadBody(await marketingMarkdownResponse(rendered, documentUrl.toString()), documentRequest.method);
    }

    const response = new Response(rendered.body, rendered);
    if (isMarkdownCandidate) appendVary(response.headers, 'Accept');
    return response;
  };

  const serve = async (): Promise<Response> => {
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
          return renderHtml(request);
        }
      }
      return renderHtml(request);
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
    if (!SKIP.test(url.pathname)) {
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
        const rewritten = new Request(url, request);
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
    ip: clientIpFromForwardedFor(request.headers.get('x-forwarded-for')),
    cookie: request.headers.get('cookie'),
    authorization: request.headers.get('authorization'),
  };
  return publishedRequestAuth.run(requestAuth, serve);
};

const handleRequest: RequestHandler<Register> = async (request, ...rest) => {
  const nonce = randomBytes(18).toString('base64');
  return ssrNonce.run(nonce, () => withSecurityHeaders(handleRequestInner(request, ...rest), nonce));
};

export default { fetch: handleRequest };
