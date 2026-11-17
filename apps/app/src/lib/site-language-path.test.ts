import { describe, expect, it } from 'vitest';
import { resolveLanguagePathRedirect } from './site-language-path';

const languages = [
  { code: 'en', isDefault: true },
  { code: 'ar', isDefault: false },
];
const resolve = (splat: string, search = '', isCustomDomain = false, hash = '') =>
  resolveLanguagePathRedirect({ splat, search, hash, isCustomDomain, languages, projectId: 'docs' });
describe('legacy language redirect matrix', () => {
  for (const custom of [false, true])
    for (const version of ['', 'v2/'])
      for (const extension of ['', '.md'])
        for (const code of ['en', 'ar']) {
          const base = custom ? '' : '/sites/docs';
          const path = `${version}guides/start${extension}`;
          const expected = `${base}/${code === 'ar' ? 'ar/' : ''}${path}?tab=cli&tag=a&tag=b#install`;
          it(`${custom ? 'custom' : 'platform'} ${code} ${path} preserves query and fragment`, () => {
            expect(resolve(path, `?lang=${code}&tab=cli&tag=a&tag=b`, custom, 'install')).toBe(expected);
            expect(resolve(`${code === 'ar' ? 'ar/' : ''}${path}`, '?tab=cli', custom)).toBeNull();
          });
        }
  it('does not invent unknown language paths', () => {
    expect(resolve('guide', '?lang=xx')).toBeNull();
  });
  it('removes a default prefix and gives the real prefix precedence', () => {
    expect(resolve('en/guide')).toBe('/sites/docs/guide');
    expect(resolve('ar/guide', '?lang=en')).toBe('/sites/docs/ar/guide');
  });
  it.each(['//evil.com', '%2F%2Fevil.com', '%5C%5Cevil.com', '/\\evil.com', '%2e%2e/%2f%2fevil.com', 'a/%252f%252fevil.com'])(
    'never redirects to another host for %s',
    (path) => {
      const target = resolve(path, '?lang=ar', true);
      if (target) expect(new URL(target, 'https://docs.example.com').origin).toBe('https://docs.example.com');
    },
  );
});
