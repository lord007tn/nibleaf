interface Env {
  APP_ORIGIN: string;
  EDGE_SECRET: string;
}

const EDGE_HOST_HEADER = 'x-nibleaf-custom-host';
const EDGE_SECRET_HEADER = 'x-nibleaf-edge-secret';

export const proxyRequest = (request: Request, env: Env): Request => {
  const incoming = new URL(request.url);
  const hostname = incoming.hostname.toLowerCase();
  const target = new URL(`${incoming.pathname}${incoming.search}`, env.APP_ORIGIN);
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
    redirect: 'manual',
  });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.EDGE_SECRET || !env.APP_ORIGIN) return new Response('Edge configuration is incomplete.', { status: 503 });
    return fetch(proxyRequest(request, env));
  },
} satisfies ExportedHandler<Env>;
