import { describe, expect, it } from 'vitest';
import { pagePublicLink } from './page-public-link';

const languages = [
  { id: 'en', code: 'en', isDefault: true },
  { id: 'ar', code: 'ar', isDefault: false },
];

describe('pagePublicLink (Copy link)', () => {
  it('links a default-language page without a language parameter, as the reader does', () => {
    expect(
      pagePublicLink('p1', { path: 'guides/install', title: 'Install', languageId: 'en' }, { primaryDomain: 'docs.example.com', languages }),
    ).toBe('https://docs.example.com/guides/install');
  });

  it('adds the language for any other language and the version prefix for a non-default version', () => {
    expect(
      pagePublicLink(
        'p1',
        { path: 'دليل/البداية', title: 'البداية', languageId: 'ar' },
        { primaryDomain: 'docs.example.com', languages, versionSlug: 'v2' },
      ),
    ).toBe('https://docs.example.com/v2/%D8%AF%D9%84%D9%8A%D9%84/%D8%A7%D9%84%D8%A8%D8%AF%D8%A7%D9%8A%D8%A9?lang=ar');
  });

  it("uses the site's Nibleaf address until a custom domain is live", () => {
    expect(pagePublicLink('p1', { path: 'start', title: 'Start', languageId: 'en' }, { slug: 'help', languages })).toMatch(/^https?:\/\/.+\/start$/);
  });
});
