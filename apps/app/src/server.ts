import type { Register } from '@tanstack/react-router';
import { createStartHandler, defaultStreamHandler, type RequestHandler } from '@tanstack/react-start/server';

/**
 * Custom server entry. Wraps TanStack Start's request handler to add
 * custom-domain serving: a request arriving on a connected, verified custom
 * domain is rewritten to the existing `/sites/:projectId/*` site routes, so the
 * domain serves the published docs at its own root (no redirect, URL preserved).
 * The dashboard's own host and internal/proxy paths are passed through untouched.
 */

const startHandler = createStartHandler(defaultStreamHandler);

// Reach the API through the app's own same-origin /api proxy — this is the path
// that works both in the container (where the server is a separate host) and in
// dev, matching how the SSR data loaders fetch.
const SELF = `http://localhost:${process.env.PORT || '4310'}`;

const ownHosts = new Set(
  [process.env.APP_URL, process.env.PUBLIC_APP_URL, 'localhost:4310', '127.0.0.1:4310'].filter(Boolean).map(
    (url) =>
      String(url)
        .replace(/^https?:\/\//, '')
        .split('/')[0]
        ?.toLowerCase() ?? '',
  ),
);

// Paths the app serves itself — never rewritten to a site route.
const SKIP = /^\/(api|_|assets|favicon|sites)\b/;

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

const handleRequest: RequestHandler<Register> = async (request, ...rest) => {
  const url = new URL(request.url);
  const host = (request.headers.get('host') || url.host).toLowerCase();
  const bare = host.split(':')[0] ?? '';

  if (!SKIP.test(url.pathname) && host && !ownHosts.has(host) && !ownHosts.has(bare)) {
    const projectId = await resolveHost(bare);
    if (projectId) {
      url.pathname = `/sites/${projectId}${url.pathname === '/' ? '' : url.pathname}`;
      return startHandler(new Request(url, request), ...rest);
    }
  }

  return startHandler(request, ...rest);
};

export default { fetch: handleRequest };
