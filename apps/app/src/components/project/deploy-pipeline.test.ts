import { describe, expect, it } from 'vitest';
import { publishedPageUrl } from './deploy-pipeline';

const site = 'https://docs.example.com';

describe('publishedPageUrl', () => {
  it('keeps default-version addresses unchanged', () => {
    expect(publishedPageUrl(site, { path: 'guides/getting-started', title: 'Start' })).toBe(`${site}/guides/getting-started`);
    expect(publishedPageUrl(site, { path: 'guides/getting-started', title: 'Start', languageCode: 'ar' })).toBe(
      `${site}/guides/getting-started?lang=ar`,
    );
  });

  it('prefixes a non-default version as the first path segment', () => {
    expect(publishedPageUrl(site, { path: 'getting-started', title: 'Start', versionSlug: 'v2' })).toBe(`${site}/v2/getting-started`);
    expect(publishedPageUrl(site, { path: 'getting-started', title: 'Start', versionSlug: 'v2', languageCode: 'pt-BR' })).toBe(
      `${site}/v2/getting-started?lang=pt-BR`,
    );
  });

  it('encodes non-Latin page addresses segment by segment', () => {
    expect(publishedPageUrl(site, { path: 'دليل/البداية', title: 'البداية', versionSlug: 'v2', languageCode: 'ar' })).toBe(
      `${site}/v2/${encodeURIComponent('دليل')}/${encodeURIComponent('البداية')}?lang=ar`,
    );
  });
});
