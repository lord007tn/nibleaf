interface Env {
  APP_ORIGIN: string;
  EDGE_SECRET: string;
}

const EDGE_HOST_HEADER = 'x-nibleaf-custom-host';
const EDGE_SECRET_HEADER = 'x-nibleaf-edge-secret';

export const proxyRequest = (request: Request, env: Env): Request => {
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
  headers.set('x-forwarded-host', hostname);
  return new Request(target, {
    method: request.method,
    headers,
    body: request.body,
    // Every customer hostname is proxied through the same app origin URL.
    // Bypass Cloudflare's subrequest cache so one site's robots, sitemap, or
    // HTML can never be replayed to a different hostname.
    cache: 'no-store',
    redirect: 'manual',
  });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.EDGE_SECRET || !env.APP_ORIGIN) return new Response('Edge configuration is incomplete.', { status: 503 });
    let forwarded: Request;
    try {
      forwarded = proxyRequest(request, env);
    } catch {
      return new Response('Edge configuration is invalid.', { status: 503 });
    }
    return fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;
