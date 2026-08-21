import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { Register } from '@tanstack/react-router';
import { createStartHandler, defaultStreamHandler, type RequestHandler } from '@tanstack/react-start/server';
import { adminContentSecurityPolicy } from '@/lib/content-security-policy';

const ssrNonce = new AsyncLocalStorage<string>();
const appOrigin = process.env.VITE_APP_URL ?? (process.env.NODE_ENV === 'production' ? 'https://nibleaf.com' : 'http://localhost:4310');

const startHandler = createStartHandler((context) => {
  const nonce = ssrNonce.getStore();
  if (nonce) {
    context.router.update({ ssr: { ...context.router.options.ssr, nonce } });
  }
  return defaultStreamHandler(context);
});

const handleRequest: RequestHandler<Register> = async (request, ...rest) => {
  const nonce = randomBytes(18).toString('base64');
  return ssrNonce.run(nonce, async () => {
    const response = await startHandler(request, ...rest);
    if (!(response.headers.get('content-type') || '').includes('text/html')) {
      return response;
    }

    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', adminContentSecurityPolicy(nonce, appOrigin));
    headers.set('cache-control', 'private, no-store');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  });
};

export default { fetch: handleRequest };
