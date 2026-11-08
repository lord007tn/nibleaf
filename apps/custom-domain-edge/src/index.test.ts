import { describe, expect, it } from 'vitest';
import { proxyRequest } from './index';

const env = {
  APP_ORIGIN: 'https://nibleaf.com',
  EDGE_SECRET: 'server-only-secret',
};

describe('custom-domain edge proxy', () => {
  it('routes a customer hostname to the one fixed app origin', () => {
    const result = proxyRequest(new Request('https://docs.customer.com/guides/start?q=1'), env);
    expect(result.url).toBe('https://nibleaf.com/guides/start?q=1');
    expect(result.headers.get('x-nibleaf-custom-host')).toBe('docs.customer.com');
    expect(result.headers.get('x-nibleaf-edge-secret')).toBe(env.EDGE_SECRET);
    expect(result.cache).toBe('no-store');
  });

  it('overwrites spoofed edge headers', () => {
    const result = proxyRequest(
      new Request('https://docs.customer.com/', { headers: { 'x-nibleaf-custom-host': 'victim.test', 'x-nibleaf-edge-secret': 'forged' } }),
      env,
    );
    expect(result.headers.get('x-nibleaf-custom-host')).toBe('docs.customer.com');
    expect(result.headers.get('x-nibleaf-edge-secret')).toBe(env.EDGE_SECRET);
  });

  it.each([
    '//other.example/path',
    '/\\other.example/path',
    '/%2f%2fother.example/path',
    '/%5cother.example/path',
    '/a/..//other.example/path',
    '/a/%2e%2e//other.example/path',
    '/../../other.example/path',
  ])('keeps %s on the configured origin', (path) => {
    const result = proxyRequest(new Request(`https://docs.customer.com${path}?q=1`), env);
    expect(new URL(result.url).origin).toBe(env.APP_ORIGIN);
    expect(new URL(result.url).search).toBe('?q=1');
  });

  it.each(['file:///tmp', 'https://user:password@nibleaf.com', 'https://nibleaf.com/base'])('rejects invalid origins: %s', (origin) => {
    expect(() => proxyRequest(new Request('https://docs.customer.com/'), { ...env, APP_ORIGIN: origin })).toThrow();
  });
});
