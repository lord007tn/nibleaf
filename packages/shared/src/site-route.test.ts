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

describe('trimSlashes', () => {
  it('trims leading and trailing slashes only', () => {
    expect(trimSlashes('///a/b//c///')).toBe('a/b//c');
    expect(trimSlashes('a')).toBe('a');
    expect(trimSlashes('')).toBe('');
    expect(trimSlashes('////')).toBe('');
  });
});

describe('site routes on adversarial paths', () => {
  // Paths longer than the reader serves are rejected before any work (their cost
  // is bounded in site-route.growth.test.ts, pnpm test:growth).
  const shapes = [
    (runs: string) => `${runs}guide${runs}`,
    (runs: string) => `${runs}x${runs}y`,
    (runs: string) => runs,
    (runs: string) => `latest${runs}guide`,
  ];
  it.each(shapes.map((shape, index) => [index, shape] as const))('rejects over-long path %i immediately', (_index, shape) => {
    const input = shape('/'.repeat(100_000));
    expect(resolveSiteRoute(site, input)).toEqual({ kind: 'not-found', reason: 'path-too-long' });
    expect(resolveSitePage(site, input, undefined, 'latest')).toBeNull();
    expect(sitePathWithinVersion(site, input, 'latest').length).toBeLessThanOrEqual(MAX_SITE_PATH_LENGTH);
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

// resolveSitePage answers from a per-snapshot index (one pass over the pages per
// version and language); each case pins what the linear scans it replaced returned.
describe('resolveSitePage lookups', () => {
  const withPages = (pages: SnapshotPage[]): SiteSnapshot => ({ ...site, pages });
  const at = (path: string, extra: Partial<SnapshotPage>): SnapshotPage => ({ ...page(path), ...extra });

  it('serves the first visible page at a path, in snapshot order', () => {
    const snapshot = withPages([
      at('setup', { id: 'hidden', hidden: true }),
      at('setup', { id: 'group', kind: 'GROUP' as SnapshotPage['kind'] }),
      at('setup', { id: 'first' }),
      at('setup', { id: 'second' }),
    ]);
    expect(resolveSitePage(snapshot, 'setup')?.page.id).toBe('first');
  });

  it('resolves a section prefix to the first page beneath it in nav order, and nothing for a partial segment', () => {
    const snapshot = withPages([at('guides/b', { id: 'b', position: 2 }), at('guides/a', { id: 'a', position: 1 }), at('guidesx', { id: 'x' })]);
    expect(resolveSitePage(snapshot, 'guides')?.page.id).toBe('a');
    expect(resolveSitePage(snapshot, 'guide')).toBeNull();
    expect(resolveSitePage(snapshot, 'guides/a/deeper')).toBeNull();
  });

  it('notices pages added to the same snapshot array', () => {
    const snapshot = withPages([page('guide')]);
    expect(resolveSitePage(snapshot, 'later')).toBeNull();
    snapshot.pages.push(page('later'));
    expect(resolveSitePage(snapshot, 'later')?.page.path).toBe('later');
  });

  it('applies the project languages of each lookup, though the pages array (and so its index) is shared', () => {
    // The published API reuses the frozen pages array across requests while the
    // live overlay changes each language's `enabled` flag; the index caches only
    // per-language page lookups, never which language a request gets.
    const pages = [page('setup'), at('setup', { id: 'ar-setup', languageCode: 'ar' })];
    const arabic = { code: 'ar', label: 'Arabic', direction: 'RTL', isDefault: false, config: null } as SiteSnapshot['project']['languages'][number];
    const withArabic = (enabled: boolean): SiteSnapshot => ({
      ...site,
      project: { ...site.project, languages: [...site.project.languages, { ...arabic, enabled }] },
      pages,
    });
    expect(resolveSitePage(withArabic(true), 'setup', 'ar')?.page.id).toBe('ar-setup');
    expect(resolveSitePage(withArabic(false), 'setup', 'ar')?.page.id).toBe('page-setup');
    expect(resolveSitePage(withArabic(true), 'setup', 'ar')?.page.id).toBe('ar-setup');
  });
});
