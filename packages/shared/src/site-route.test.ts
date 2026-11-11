import { describe, expect, it } from 'vitest';
import type { SiteSnapshot, SnapshotPage } from './site';
import { MAX_SITE_PATH_LENGTH, resolveSitePage, resolveSiteRoute, sitePathWithinVersion, trimSlashes } from './site-route';

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

/** Elapsed milliseconds for `run`, best of three to damp machine noise. */
const time = (run: () => void): number => {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = performance.now();
    run();
    best = Math.min(best, performance.now() - started);
  }
  return best;
};

describe('trimSlashes', () => {
  it('trims leading and trailing slashes only', () => {
    expect(trimSlashes('///a/b//c///')).toBe('a/b//c');
    expect(trimSlashes('a')).toBe('a');
    expect(trimSlashes('')).toBe('');
    expect(trimSlashes('////')).toBe('');
  });
});

describe('site routes on adversarial paths', () => {
  // Paths longer than the reader serves are rejected before any work, so a
  // 100k-slash path costs a constant amount of time, not a multiple of a scan.
  const runs = '/'.repeat(100_000);
  const inputs = [`${runs}guide${runs}`, `${runs}x${runs}y`, runs, `latest${runs}guide`];

  it.each(inputs.map((input, index) => [index, input] as const))('rejects over-long path %i immediately', (_index, input) => {
    const elapsed = time(() => {
      expect(resolveSiteRoute(site, input)).toEqual({ kind: 'not-found', reason: 'path-too-long' });
      expect(resolveSitePage(site, input, undefined, 'latest')).toBeNull();
      expect(sitePathWithinVersion(site, input, 'latest').length).toBeLessThanOrEqual(MAX_SITE_PATH_LENGTH);
    });
    expect(elapsed).toBeLessThan(20);
  });

  it('still resolves a legitimate 2,000-character path', () => {
    const slug = 'a'.repeat(1990);
    const long = { ...site, pages: [...site.pages, page(slug)] } as SiteSnapshot;
    const path = `/${slug}/`;
    expect(path.length).toBeLessThanOrEqual(MAX_SITE_PATH_LENGTH);
    expect(resolveSiteRoute(long, path)).toMatchObject({ kind: 'page', page: { path: slug } });
    // One character over the limit is rejected.
    expect(resolveSiteRoute(long, `/${'a'.repeat(MAX_SITE_PATH_LENGTH)}`)).toEqual({ kind: 'not-found', reason: 'path-too-long' });
  });

  it('still trims slashes around a path the reader serves', () => {
    const slashes = '/'.repeat(500);
    expect(resolveSiteRoute(site, `${slashes}guide${slashes}`)).toMatchObject({ kind: 'page', page: { path: 'guide' } });
    expect(resolveSiteRoute(site, `${slashes}api-reference${slashes}`)).toEqual({ kind: 'openapi' });
  });
});
