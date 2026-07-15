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
  });

  it('overwrites spoofed edge headers', () => {
    const result = proxyRequest(
      new Request('https://docs.customer.com/', { headers: { 'x-nibleaf-custom-host': 'victim.test', 'x-nibleaf-edge-secret': 'forged' } }),
      env,
    );
    expect(result.headers.get('x-nibleaf-custom-host')).toBe('docs.customer.com');
    expect(result.headers.get('x-nibleaf-edge-secret')).toBe(env.EDGE_SECRET);
  });
});
