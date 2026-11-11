import { describe, expect, it } from 'vitest';
import type { SiteSnapshot, SnapshotPage } from './site';
import { resolveSitePage, resolveSiteRoute, sitePathWithinVersion, trimSlashes } from './site-route';

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
  // 100k slashes around and inside the path: each lookup must stay within 10× a
  // plain linear pass over the same input, plus 20 ms of fixed overhead.
  const runs = '/'.repeat(100_000);
  const inputs = [`${runs}guide${runs}`, `${runs}x${runs}y`, runs, `latest${runs}guide`];
  const linearPass = (value: string) => {
    let slashes = 0;
    for (let index = 0; index < value.length; index++) if (value.charCodeAt(index) === 47) slashes++;
    return slashes;
  };

  it.each(inputs.map((input, index) => [index, input] as const))('resolves adversarial path %i in linear time', (_index, input) => {
    const baseline = time(() => linearPass(input));
    const elapsed = time(() => {
      trimSlashes(input);
      sitePathWithinVersion(site, input, 'latest');
      resolveSitePage(site, input, undefined, 'latest');
      resolveSiteRoute(site, input);
    });
    expect(elapsed).toBeLessThanOrEqual(10 * baseline + 20);
  });

  it('still resolves the page and the API reference behind long slash runs', () => {
    expect(resolveSiteRoute(site, `${runs}guide${runs}`)).toMatchObject({ kind: 'page', page: { path: 'guide' } });
    expect(resolveSiteRoute(site, `${runs}api-reference${runs}`)).toEqual({ kind: 'openapi' });
    expect(resolveSiteRoute(site, runs)).toMatchObject({ kind: 'page', page: { path: 'guide' } });
  });
});
