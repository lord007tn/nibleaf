import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Register } from '@tanstack/react-router';
import { createStartHandler, defaultStreamHandler, type RequestHandler } from '@tanstack/react-start/server';
import { serverEnv } from '@/env.server';
import { adminContentSecurityPolicy } from '@/lib/content-security-policy';

const ssrNonce = new AsyncLocalStorage<string>();
const appOrigin = serverEnv.VITE_APP_URL ?? (serverEnv.NODE_ENV === 'production' ? 'https://nibleaf.com' : 'http://localhost:4310');
const revision = process.env.NIBLEAF_REVISION ?? 'development';
const drainFile = process.env.NIBLEAF_DRAIN_FILE ?? '/tmp/nibleaf-draining';

const startHandler = createStartHandler((context) => {
  const nonce = ssrNonce.getStore();
  if (nonce) {
    context.router.update({ ssr: { ...context.router.options.ssr, nonce } });
  }
  return defaultStreamHandler(context);
});

const handleRequest: RequestHandler<Register> = async (request, ...rest) => {
  if (new URL(request.url).pathname === '/health') {
    const draining = existsSync(drainFile);
    return Response.json(
      { status: draining ? 'shutting_down' : 'ok', service: 'admin', revision },
      { status: draining ? 503 : 200, headers: { 'cache-control': 'no-store', 'x-nibleaf-revision': revision } },
    );
  }
  const nonce = randomBytes(18).toString('base64');
  return ssrNonce.run(nonce, async () => {
    const response = await startHandler(request, ...rest);
    const headers = new Headers(response.headers);
    headers.set('x-nibleaf-revision', revision);
    if (!(response.headers.get('content-type') || '').includes('text/html')) {
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    headers.set('Content-Security-Policy', adminContentSecurityPolicy(nonce, appOrigin));
    headers.set('cache-control', 'private, no-store');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  });
};

export default { fetch: handleRequest };
