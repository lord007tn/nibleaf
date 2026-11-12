import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { collectPublishChecks } from './publish-checks';

const page = (index: number, run: string): SnapshotPage => ({
  id: `page-${index}`,
  parentId: null,
  versionId: 'v1',
  updatedAt: '2026-11-01T00:00:00.000Z',
  languageCode: 'en',
  kind: 'PAGE',
  title: `Topic ${index}`,
  slug: `page-${index}`,
  icon: null,
  description: null,
  // One link to the next page (the last one is broken) and one image without alt text.
  content: `[next](/section-${(index + 1) % 20}/page-${index + 1})\n\n![](/img-${index}.png)${run}`,
  config: null,
  translationKey: null,
  position: index,
  hidden: false,
  path: `section-${index % 20}/page-${index}`,
});

const site = (count: number, run = ''): SiteSnapshot => ({
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
  pages: Array.from({ length: count }, (_, index) => page(index, run)),
  generatedAt: '2026-11-01T00:00:00.000Z',
});

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
// Linear work measures about 4x for 4x the pages; quadratic work (every link
// resolved by scanning every page) 16x.
describe.runIf(growthTestsEnabled)('publish checks on a large site: growth', () => {
  it('stays linear on a first open: every page parsed, every link resolved', () => {
    // A new pages array and new content per run, so neither the per-snapshot
    // caches (page index, content facts) nor the shared facts cache can answer.
    const [small, large] = growthMs(collectPublishChecks, site(50), site(200), {
      vary: (input, rep) => site(input.pages.length, ` ${rep}`),
    });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('stays linear on case A', () => {
    const build = (n: number) => site(1, `\n\n~~~\n${'<!-- a'.repeat(n)}\n~~~`);
    // The same snapshot each call: the parsed facts are cached, the rest is read again.
    const [small, large] = growthMs(collectPublishChecks, build(4000), build(16_000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  }, 60_000);

  it('stays linear on a repeat open of the same snapshot', () => {
    const [small, large] = growthMs(collectPublishChecks, site(100), site(400));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});
