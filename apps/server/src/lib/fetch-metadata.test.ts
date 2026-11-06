import { describe, expect, it } from 'vitest';
import { restoreNavigationFetchMetadata } from './fetch-metadata';

const request = (method: string, headers: Record<string, string>) =>
  new Request('http://api.test/api/auth/oauth2/authorize?client_id=x', { method, headers });

describe('restoreNavigationFetchMetadata', () => {
  it('turns a proxied top-level navigation back into a navigation', () => {
    const restored = restoreNavigationFetchMetadata(request('GET', { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'document', accept: 'text/html' }));
    expect(restored.headers.get('sec-fetch-mode')).toBe('navigate');
    expect(restored.headers.get('accept')).toBe('text/html');
    expect(restored.url).toBe('http://api.test/api/auth/oauth2/authorize?client_id=x');
  });

  it('also covers framed navigations', () => {
    expect(
      restoreNavigationFetchMetadata(request('GET', { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'iframe' })).headers.get('sec-fetch-mode'),
    ).toBe('navigate');
  });

  it('leaves browser fetch() calls, POSTs and unmarked requests alone', () => {
    const fetchCall = request('GET', { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' });
    expect(restoreNavigationFetchMetadata(fetchCall)).toBe(fetchCall);
    const post = request('POST', { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'document' });
    expect(restoreNavigationFetchMetadata(post)).toBe(post);
    const plain = request('GET', {});
    expect(restoreNavigationFetchMetadata(plain)).toBe(plain);
  });
});
