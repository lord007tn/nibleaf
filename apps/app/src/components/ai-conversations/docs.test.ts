import { describe, expect, it } from 'vitest';
import { searchAiDocsUrl } from './docs';

describe('AI search setup documentation', () => {
  it.each([
    ['en', '/self-hosting/search-ai'],
    ['ar', '/ar/self-hosting/search-ai'],
    ['fr', '/self-hosting/search-ai'],
  ])('opens the published docs for %s', (locale, path) => {
    const url = new URL(searchAiDocsUrl(locale));
    expect(url.origin).toBe('https://docs.nibleaf.com');
    expect(url.pathname).toBe(path);
  });
});
