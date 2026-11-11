import { describe, expect, it } from 'vitest';
import { findInboundPageLinks } from './publish-checks';
import type { SiteSnapshot, SnapshotPage } from './site';
import { growthTestsEnabled } from './testing/growth';

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

// Timing bounds, run on their own (pnpm test:growth; see testing/growth).
describe.runIf(growthTestsEnabled)('inbound draft page links: repeat-open cost', () => {
  const target = () => page({ id: 'target', path: 'guide', kind: 'GROUP' });
  const child = () => page({ id: 'child', parentId: 'target', path: 'guide/setup', content: '[self](/guide/setup)' });

  it('answers a repeat open from the content cache: warm costs at most half the cold scan', () => {
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
    // would cost about what the cold scan did.
    expect(warmMs).toBeLessThanOrEqual(coldMs / 2 + 20);
  }, 60_000);
});
