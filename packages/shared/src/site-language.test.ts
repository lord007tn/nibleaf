import { describe, expect, it } from 'vitest';
import { parseSiteLanguagePath, publishedSitePath } from './site-language';
import { legacySiteLanguageTarget } from './site-language-redirect';

const languages = [
  { code: 'en', isDefault: true },
  { code: 'pt-BR', isDefault: false },
  { code: 'ar', isDefault: false },
];
describe('published document paths', () => {
  it('places language before version, with each segment encoded once', () => {
    expect(publishedSitePath('guide/start', 'pt-BR', 'v2')).toBe('/pt-BR/v2/guide/start');
    expect(publishedSitePath('guide/%D8%A7', 'ar')).toBe('/ar/guide/%D8%A7');
    expect(publishedSitePath('guide/start')).toBe('/guide/start');
  });
  it('parses published regional codes and leaves unknown prefixes as page paths', () => {
    expect(parseSiteLanguagePath('/pt-br/v2/guide', languages)).toEqual({ language: languages[1], path: 'v2/guide' });
    expect(parseSiteLanguagePath('/unknown/guide', languages)).toEqual({ path: 'unknown/guide' });
  });
  it('trims long slash runs without a backtracking expression', () => {
    expect(parseSiteLanguagePath(`${'/'.repeat(50_000)}ar/guide${'/'.repeat(50_000)}`, languages)).toEqual({ language: languages[2], path: 'guide' });
  });
  it('migrates the root Markdown alias and removes explicit default language queries', () => {
    expect(legacySiteLanguageTarget({ path: '_index.md', languages, basePath: '', search: '?lang=ar' })).toBe('/ar.md');
    expect(legacySiteLanguageTarget({ path: 'guide.md', languages, basePath: '', search: '?lang=en' })).toBe('/guide.md');
  });
});

it('prepends the selected language to the entire legacy query path', () => {
  expect(legacySiteLanguageTarget({ path: 'ar/guide', languages, basePath: '', search: '?lang=ar&tab=cli' })).toBe('/ar/ar/guide?tab=cli');
});
