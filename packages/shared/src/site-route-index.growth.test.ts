import { describe, expect, it } from 'vitest';
import { findBrokenInternalLinks } from './publish-checks';
import type { SiteSnapshot, SnapshotPage } from './site';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';

/** A site of `count` pages in 20 sections, each page with 10 internal links:
 *  neighbours, a section, a missing page and a page in another section. */
const siteOf = (count: number): SiteSnapshot => {
  const path = (index: number) => `section-${(((index % count) + count) % count) % 20}/page-${((index % count) + count) % count}`;
  const pages = Array.from({ length: count }, (_, index): SnapshotPage => {
    const links = [
      path(index + 1),
      path(index - 1),
      path(index + 7),
      path(index + 13),
      path(index + 101),
      `section-${index % 20}`,
      `section-${(index + 3) % 20}`,
      `missing-${index}`,
      `section-${index % 20}/missing-${index}`,
      path(index + count / 2),
    ];
    return {
      id: `page-${index}`,
      parentId: null,
      versionId: 'v1',
      updatedAt: '2026-11-01T00:00:00.000Z',
      languageCode: 'en',
      kind: 'PAGE',
      title: `Topic ${index}`,
      slug: `page-${index}`,
      path: path(index),
      icon: null,
      description: null,
      content: links.map((href, n) => `[link ${n}](/${href})`).join(' '),
      config: null,
      translationKey: null,
      position: index,
      hidden: false,
    };
  });
  return {
    project: {
      id: 'project-1',
      name: 'Docs',
      slug: 'docs',
      description: null,
      icon: null,
      config: null,
      languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null }],
      versions: [{ id: 'v1', name: 'Latest', slug: 'latest', isDefault: true }],
    },
    pages,
    generatedAt: '2026-11-01T00:00:00.000Z',
    openapi: null,
  } as unknown as SiteSnapshot;
};

// Timing bounds, run on their own (pnpm test:growth; see testing/growth).
describe.runIf(growthTestsEnabled)('route lookups for a site link check: growth', () => {
  it('checks 4x the pages for about 4x the time, not 16x', () => {
    const small = siteOf(400);
    const large = siteOf(1600);
    // Each call gets a fresh pages array, so it pays for its own lookups (the
    // per-snapshot index included); the parsed page facts stay cached, so this
    // measures route resolution, not Markdown parsing.
    const fresh = { vary: (snapshot: SiteSnapshot) => ({ ...snapshot, pages: [...snapshot.pages] }) };
    expect(findBrokenInternalLinks(large).length).toBeGreaterThan(0);
    const [smallMs, largeMs] = growthMs(findBrokenInternalLinks, small, large, fresh);
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
  }, 120_000);
});
