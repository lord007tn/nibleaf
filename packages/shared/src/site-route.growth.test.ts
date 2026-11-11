import { describe, expect, it } from 'vitest';
import type { SiteSnapshot, SnapshotPage } from './site';
import { resolveSitePage, resolveSiteRoute, sitePathWithinVersion } from './site-route';
import { constantGrowthLimit, growthMs, growthTestsEnabled } from './testing/growth';

const page = (path: string): SnapshotPage => ({
  id: `page-${path}`,
  path,
  parentId: null,
  versionId: 'v1',
  updatedAt: '2026-11-01T00:00:00.000Z',
  languageCode: 'en',
  kind: 'PAGE',
  title: path,
  slug: path.split('/').at(-1) ?? '',
  icon: null,
  description: null,
  content: 'Body.',
  config: null,
  translationKey: null,
  position: 0,
  hidden: false,
});

const site: SiteSnapshot = {
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
  pages: [page('guide')],
  generatedAt: '2026-11-01T00:00:00.000Z',
  openapi: { title: 'API', path: 'api-reference', contentHash: 'h', updatedAt: '2026-11-01T00:00:00.000Z', document: {} },
} as SiteSnapshot;

// Timing bounds, run on their own (pnpm test:growth; see testing/growth).
describe.runIf(growthTestsEnabled)('site routes on adversarial paths: growth', () => {
  // Paths longer than the reader serves are rejected before any work, so a
  // 100k-slash path costs what a 25k one does, not a multiple of a scan (constant bound).
  const shapes = [
    (runs: string) => `${runs}guide${runs}`,
    (runs: string) => `${runs}x${runs}y`,
    (runs: string) => runs,
    (runs: string) => `latest${runs}guide`,
  ];
  const resolveAll = (input: string) => {
    resolveSiteRoute(site, input);
    resolveSitePage(site, input, undefined, 'latest');
    sitePathWithinVersion(site, input, 'latest');
  };

  it.each(shapes.map((shape, index) => [index, shape] as const))('rejects over-long path %i immediately', (_index, shape) => {
    const input = shape('/'.repeat(100_000));
    const [small, large] = growthMs(resolveAll, shape('/'.repeat(25_000)), input, { minMs: 12 });
    expect(large).toBeLessThanOrEqual(constantGrowthLimit(small));
  });
});
