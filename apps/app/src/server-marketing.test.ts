import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handler: vi.fn(),
}));
vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  createStartHandler: () => mocks.handler,
}));
vi.mock('@/env.server', () => ({ serverEnv: { APP_URL: 'https://nibleaf.com', PORT: 4450, TRUSTED_PROXY_HOPS: 0 } }));
vi.mock('@nibleaf/i18n', () => ({ translateFn: () => 'translation' }));
vi.mock('@/lib/blog', () => ({ BLOG_ENTRIES: [] }));

import server from './server';

beforeEach(() => {
  mocks.handler.mockImplementation(
    async () => new Response('<!doctype html><html><script>console.log("static")</script></html>', { headers: { 'content-type': 'text/html' } }),
  );
});

it.each(['/', '/ar', '/pricing', '/about', '/developers'])('shares eligible marketing HTML at %s with hash CSP', async (path) => {
  const first = await server.fetch(new Request(`https://nibleaf.com${path}`));
  const second = await server.fetch(new Request(`https://nibleaf.com${path}`, { headers: { 'user-agent': 'Googlebot' } }));
  expect(first.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
  expect(first.headers.get('content-security-policy')).toContain('sha256-');
  expect(first.headers.get('content-security-policy')).toBe(second.headers.get('content-security-policy'));
  expect(await first.text()).toBe(await second.text());
  const head = await server.fetch(new Request(`https://nibleaf.com${path}`, { method: 'HEAD' }));
  expect(await head.text()).toBe('');
  expect(head.headers.get('content-security-policy')).toBe(first.headers.get('content-security-policy'));
});

it.each([
  ['https://nibleaf.com/', { cookie: 'better-auth.session_token=fixture' }],
  ['https://nibleaf.com/', { cookie: 'other=fixture' }],
  ['https://nibleaf.com/', { authorization: 'Bearer fixture' }],
  ['https://nibleaf.com/?anything=1', {}],
  ['https://nibleaf.com/sign-in', {}],
  ['https://nibleaf.com/app', {}],
  ['https://nibleaf.com/ar/sign-in', {}],
])('keeps sensitive or non-marketing requests private: %s %j', async (url, headers) => {
  const response = await server.fetch(new Request(url, { headers }));
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('content-security-policy')).toContain('nonce-');
});

it('preserves content negotiation when rendering a marketing HEAD as GET', async () => {
  const accept = 'text/markdown, text/html;q=0.5';
  const get = await server.fetch(new Request('https://nibleaf.com/pricing', { headers: { accept } }));
  const head = await server.fetch(new Request('https://nibleaf.com/pricing', { method: 'HEAD', headers: { accept } }));
  expect(head.status).toBe(get.status);
  expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
  expect(await head.text()).toBe('');
});
