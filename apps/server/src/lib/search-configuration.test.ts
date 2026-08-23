import type { SiteSnapshot } from '@nibleaf/shared/site';
import { describe, expect, it } from 'vitest';
import { resolvePublishedSearchContext, resolvePublishedSearchRequest } from './search-configuration';

const snapshot = (search: Record<string, unknown>): SiteSnapshot => ({
  project: {
    id: 'project-1',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    config: { search },
    languages: [
      { code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, config: null },
      { code: 'ar', label: 'Arabic', direction: 'RTL', isDefault: false, enabled: true, config: null },
    ],
    versions: [
      { id: 'version-main', name: 'Main', slug: 'main', isDefault: true },
      { id: 'version-next', name: 'Next', slug: 'next', isDefault: false },
    ],
  },
  pages: [],
  generatedAt: '2026-08-23T00:00:00.000Z',
});

describe('published search configuration', () => {
  it('defaults malformed legacy config and caps caller result limits', () => {
    expect(resolvePublishedSearchRequest({ search: { maxResults: 'all' } }, { language: 'ar', version: 'next', limit: 50 })).toMatchObject({
      language: 'ar',
      version: 'next',
      limit: 12,
      configuration: { maxResults: 12, filtersEnabled: true, versionFilterEnabled: true },
    });
    expect(resolvePublishedSearchRequest({ search: { maxResults: 20 } }, { limit: 5 }).limit).toBe(5);
  });

  it.each([
    { filtersEnabled: false, versionFilterEnabled: true },
    { filtersEnabled: true, versionFilterEnabled: false },
    { filtersEnabled: false, versionFilterEnabled: false },
  ])('preserves the active language and version when selector visibility is $filtersEnabled/$versionFilterEnabled', (visibility) => {
    expect(resolvePublishedSearchRequest({ search: { ...visibility, maxResults: 7 } }, { language: 'ar', version: 'next', limit: 40 })).toMatchObject(
      { language: 'ar', version: 'next', limit: 7 },
    );
  });

  it.each([
    ['keyword', { filtersEnabled: false, versionFilterEnabled: true }],
    ['answer', { filtersEnabled: true, versionFilterEnabled: false, aiAnswers: true }],
  ])('%s action context keeps Arabic and the non-default version when its selector is hidden', (_path, search) => {
    const context = resolvePublishedSearchContext(snapshot(search), { language: 'ar', version: 'next' });
    expect(context).toMatchObject({ language: 'ar', version: { id: 'version-next', slug: 'next' } });
  });

  it('falls back unknown language and version values to published defaults', () => {
    const context = resolvePublishedSearchContext(snapshot({}), { language: 'unknown', version: 'unknown' });
    expect(context).toMatchObject({ language: 'en', version: { id: 'version-main', slug: 'main' } });
  });
});
