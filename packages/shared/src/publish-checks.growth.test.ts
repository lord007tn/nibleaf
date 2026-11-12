import { growthMs, growthMsAsync, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { buildInboundPageLinkMap, buildInboundPageLinkMapAsync, findBrokenInternalLinks, findInboundPageLinks } from './publish-checks';
import type { SiteSnapshot, SnapshotPage } from './site';

let sequence = 0;
const page = (overrides: Partial<SnapshotPage> & Pick<SnapshotPage, 'path'>): SnapshotPage => {
  sequence += 1;
  return {
    id: `page-${sequence}`,
    parentId: null,
    versionId: 'v1',
    updatedAt: '2026-11-01T00:00:00.000Z',
    languageCode: 'en',
    kind: 'PAGE',
    title: `Page ${sequence}`,
    slug: overrides.path.split('/').at(-1) ?? '',
    icon: null,
    description: null,
    content: 'Body.',
    config: null,
    translationKey: null,
    position: sequence,
    hidden: false,
    ...overrides,
  };
};

const site = (pages: SnapshotPage[]): SiteSnapshot => ({
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
});

describe.runIf(growthTestsEnabled)('cold inbound page map: growth', () => {
  const run = Math.random().toString(36).slice(2);
  const coldSite = ({ count, rep, mode }: { count: number; rep: number; mode: string }) =>
    site(
      Array.from({ length: count }, (_, i) =>
        page({
          id: `cold-${i}`,
          path: `cold-${i}`,
          content: `# Topic ${run}-${mode}-${count}-${rep}-${i}\n\n[Next](/cold-${(i + 1) % count})\n\n${'Reference documentation for this topic. '.repeat(30)}`,
        }),
      ),
    );
  const small = { count: 550, rep: 0, mode: 'sync' };
  const large = { count: 2200, rep: 0, mode: 'sync' };
  // Vary only an O(1) token; fixture construction and parsing are measured.
  // Every call has unique bodies and a fresh snapshot, bypassing both caches.
  const options = { vary: (input: typeof small, rep: number) => ({ ...input, rep }) };
  it('builds the synchronous map for 4x the cold pages in linear time', () => {
    const [smallMs, largeMs] = growthMs((input) => buildInboundPageLinkMap(coldSite(input)), small, large, options);
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
  }, 120_000);
  it('builds the yielding map for 4x the cold pages in linear time', async () => {
    const [smallMs, largeMs] = await growthMsAsync(
      (input) => buildInboundPageLinkMapAsync(coldSite(input)),
      { ...small, mode: 'async' },
      { ...large, mode: 'async' },
      options,
    );
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
  }, 120_000);
});

// Timing bounds, run on their own (pnpm test:growth; see testing/growth).
describe.runIf(growthTestsEnabled)('inbound draft page links: repeat-open cost', () => {
  const target = () => page({ id: 'target', path: 'guide', kind: 'GROUP' });
  const child = () => page({ id: 'child', parentId: 'target', path: 'guide/setup', content: '[self](/guide/setup)' });

  it('answers a repeat open from the content cache: warm costs at most a quarter of the cold scan', () => {
    const snapshot = site([
      ...Array.from({ length: 298 }, (_, i) =>
        page({
          path: `cost-${i}`,
          content: `# Topic ${i}\n\n${Array.from({ length: 4 }, (_, j) => `[related](/cost-${(i + j + 1) % 298})`).join(' ')} [guide](/old-setup)\n\n${'Useful documentation. '.repeat(30)}`,
        }),
      ),
      target(),
      child(),
    ]);
    snapshot.project.config = { redirects: [{ from: '/old-setup', to: '/guide/setup' }] };
    const coldStart = performance.now();
    expect(findInboundPageLinks(snapshot, 'target').total).toBe(298);
    const coldMs = performance.now() - coldStart;
    let warmMs = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 3; round++) {
      const start = performance.now();
      expect(findInboundPageLinks(snapshot, 'target').total).toBe(298);
      warmMs = Math.min(warmMs, performance.now() - start);
    }
    // Like for like on the same runner: re-parsing every body on a repeat open
    // would cost about what the cold scan did. Measured warm at about 1/100 of
    // cold with the page index (1/45 without it).
    expect(warmMs).toBeLessThanOrEqual(coldMs / 4 + 20);
  }, 60_000);
});

describe.runIf(growthTestsEnabled)('publish checks on a site larger than the shared facts cache', () => {
  it('answers a repeat scan of 2,500 pages from the snapshot: warm costs at most a quarter of the cold scan', () => {
    // Unique per run, so the cold scan parses every page; no internal links, so
    // the scan's cost is parsing alone.
    const run = Math.random().toString(36).slice(2);
    const snapshot = site(
      Array.from({ length: 2500 }, (_, i) =>
        page({ path: `large-${i}`, content: `# Topic ${i} ${run}\n\n![](/img-${i}.png)\n\n${'Useful documentation. '.repeat(30)}` }),
      ),
    );
    const coldStart = performance.now();
    expect(findBrokenInternalLinks(snapshot)).toEqual([]);
    const coldMs = performance.now() - coldStart;
    let warmMs = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 3; round++) {
      const start = performance.now();
      expect(findBrokenInternalLinks(snapshot)).toEqual([]);
      warmMs = Math.min(warmMs, performance.now() - start);
    }
    // Like for like on the same runner: a scan that evicts the shared cache in
    // order re-parses every page on the next one, costing what the cold scan did.
    expect(warmMs).toBeLessThanOrEqual(coldMs / 4 + 20);
  }, 60_000);
});
