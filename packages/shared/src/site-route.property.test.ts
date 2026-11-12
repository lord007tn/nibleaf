import { describe, expect, it } from 'vitest';
import { defaultLanguage, type SiteSnapshot, type SnapshotPage } from './site';
import {
  activeLanguageCode,
  activeVersion,
  firstPage,
  firstPageUnder,
  matchingVersion,
  pagesForLanguage,
  pagesForVersion,
  resolveSitePage,
  resolveSiteRoute,
  sitePathTooLong,
  sitePathWithinVersion,
} from './site-route';

/** The page lookup as it was before the per-snapshot index: linear scans over the
 *  snapshot, built from the exported helpers (unchanged). The reference oracle.
 *  Each scan (a version and language's pages, and the page found at a normalized
 *  path) runs once per site and is reused across queries, so the test's cost is
 *  the queries, not the oracle re-scanning per query. */
const referenceResolver = (snapshot: SiteSnapshot) => {
  const scans = new Map<string, { page: SnapshotPage; pages: SnapshotPage[] } | undefined>();
  const langPagesByScope = new Map<string, SnapshotPage[]>();
  return (path: string, lang?: string, version?: string) => {
    if (sitePathTooLong(path)) return null;
    const explicitVersion = matchingVersion(snapshot, version);
    const normalized = sitePathWithinVersion(snapshot, path, version);
    const activeLanguage = activeLanguageCode(snapshot, lang);
    const docsVersion = explicitVersion ?? activeVersion(snapshot, version);
    const findIn = (langCode: string) => {
      const key = `${docsVersion.id}|${langCode}|${normalized}`;
      if (scans.has(key)) return scans.get(key);
      const scope = `${docsVersion.id}|${langCode}`;
      let langPages = langPagesByScope.get(scope);
      if (!langPages) {
        langPages = pagesForLanguage(pagesForVersion(snapshot, docsVersion), langCode);
        langPagesByScope.set(scope, langPages);
      }
      const found =
        langPages.find((p) => p.path === normalized && p.kind === 'PAGE' && !p.hidden) ??
        (normalized === '' ? firstPage(langPages, langCode) : undefined) ??
        firstPageUnder(langPages, langCode, normalized);
      const result = found ? { page: found, pages: langPages } : undefined;
      scans.set(key, result);
      return result;
    };
    const defaultCode = defaultLanguage(snapshot.project).code;
    const match = findIn(activeLanguage) ?? (activeLanguage === defaultCode ? undefined : findIn(defaultCode));
    return match ? { ...match, docsVersion, normalized } : null;
  };
};

const random = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
};

/** A random site: two versions, three languages (one sometimes disabled), hidden
 *  pages, groups, duplicate and nested paths, random nav order, and redirects. */
const randomSite = (seed: number): { snapshot: SiteSnapshot; paths: string[] } => {
  const next = random(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const segments = ['guides', 'setup', 'api', 'intro', 'a', 'b', 'deep'];
  const pages: SnapshotPage[] = Array.from({ length: 1 + Math.floor(next() * 30) }, (_, index) => {
    const path = Array.from({ length: 1 + Math.floor(next() * 3) }, () => pick(segments)).join('/');
    return {
      id: `p${index}`,
      parentId: index > 0 && next() > 0.5 ? `p${Math.floor(next() * index)}` : null,
      versionId: pick(['v1', 'v1', 'v2']),
      updatedAt: '2026-11-01T00:00:00.000Z',
      languageCode: pick(['en', 'en', 'ar', 'fr']),
      kind: pick(['PAGE', 'PAGE', 'PAGE', 'GROUP']),
      title: `T${index}`,
      slug: path.split('/').at(-1) ?? '',
      path,
      icon: null,
      description: null,
      content: '',
      config: null,
      translationKey: null,
      position: Math.floor(next() * 10),
      hidden: next() > 0.85,
    } as SnapshotPage;
  });
  const redirects = [
    { from: '/old', to: pick(pages)?.path ? `/${pick(pages).path}` : '/missing' },
    { from: '/elsewhere', to: 'https://example.com/x' },
  ];
  const snapshot = {
    project: {
      id: 'p',
      name: 'Docs',
      slug: 'docs',
      description: null,
      icon: null,
      config: { redirects },
      languages: [
        { code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null },
        { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, config: null },
        { code: 'fr', label: 'Français', direction: 'LTR', isDefault: false, config: null, enabled: next() > 0.5 ? false : undefined },
      ],
      versions: [
        { id: 'v1', name: 'Latest', slug: 'latest', isDefault: true },
        { id: 'v2', name: 'v2', slug: 'v2', isDefault: false },
      ],
    },
    pages,
    generatedAt: '2026-11-01T00:00:00.000Z',
    openapi: null,
  } as unknown as SiteSnapshot;
  const paths = ['', '/', 'missing', 'old', 'elsewhere', 'v2', 'v2/guides', 'latest/guides', 'guides/nope', 'ar', 'ar/guides'];
  for (const page of pages) {
    paths.push(page.path, `/${page.path}/`, `v2/${page.path}`, page.path.split('/')[0] ?? '');
    if (page.path.includes('/')) paths.push(page.path.split('/').slice(0, 2).join('/'));
  }
  return { snapshot, paths: [...new Set(paths)] };
};

const shape = (resolved: ReturnType<typeof resolveSitePage>) =>
  resolved
    ? { page: resolved.page.id, pages: resolved.pages.map((page) => page.id), version: resolved.docsVersion.id, normalized: resolved.normalized }
    : null;

/** Every path, language and version option on `seeds` random sites, against the
 *  reference; returns the number of checks and the first mismatches. */
const compareOn = (seeds: number) => {
  let checks = 0;
  const mismatches: string[] = [];
  // Which of the cases the generator aims for these seeds actually reached.
  const covered = new Set<string>();
  for (let seed = 1; seed <= seeds; seed += 1) {
    const { snapshot, paths } = randomSite(seed);
    const reference = referenceResolver(snapshot);
    const seen = new Set<string>();
    for (const page of snapshot.pages) {
      if (page.hidden) covered.add('hidden page');
      if (page.kind === 'GROUP') covered.add('group');
      if (page.versionId === 'v2') covered.add('second version');
      if (page.path.includes('/')) covered.add('nested path');
      const scope = `${page.versionId}|${page.languageCode}|${page.path}`;
      if (seen.has(scope)) covered.add('duplicate path');
      seen.add(scope);
    }
    if (snapshot.project.languages.some((language) => language.enabled === false)) covered.add('disabled language');
    for (const path of paths) {
      for (const lang of [undefined, 'en', 'ar', 'fr', 'de']) {
        for (const version of [undefined, 'latest', 'v2', 'nope', path.split('/')[0]]) {
          const actual = JSON.stringify(shape(resolveSitePage(snapshot, path, lang, version)));
          const found = reference(path, lang, version);
          if (found && found.normalized !== '' && found.page.path !== found.normalized) covered.add('section prefix hit');
          if (!found && path.includes('/')) covered.add('section prefix miss');
          const expected = JSON.stringify(shape(found));
          if (actual !== expected && mismatches.length < 5)
            mismatches.push(`seed ${seed} path ${path} lang ${lang} version ${version}: ${actual} vs ${expected}`);
          checks += 1;
        }
        // The route serves the page the lookup finds (it passes the first segment as the version).
        const route = resolveSiteRoute(snapshot, path, { lang });
        if (route.kind === 'redirect') covered.add(`${route.reason} redirect`);
        const splat = path.replace(/^\/+|\/+$/g, '');
        const expected = reference(splat, lang, splat ? splat.split('/')[0] : undefined);
        if ((route.kind === 'page' ? route.page.id : null) !== (expected?.page.id ?? null) && mismatches.length < 5)
          mismatches.push(`route seed ${seed} path ${path} lang ${lang}`);
        checks += 1;
      }
    }
  }
  return { checks, mismatches, covered: [...covered].sort() };
};

const ALL_CASES = [
  'configured redirect',
  'disabled language',
  'duplicate path',
  'group',
  'hidden page',
  'nested path',
  'second version',
  'section prefix hit',
  'section prefix miss',
];

describe('resolveSitePage against the linear-scan reference', () => {
  it('answers every path, language and version exactly as the linear scans did, on randomized sites', () => {
    const { checks, mismatches, covered } = compareOn(12);
    expect(mismatches).toEqual([]);
    expect(checks).toBeGreaterThan(5000);
    // Fewer seeds than the deep run, still every kind of case.
    expect(covered).toEqual(expect.arrayContaining(ALL_CASES));
  }, 30_000);

  // The same comparison on 400 sites, for a change to the resolver or the index:
  // NIBLEAF_PROPERTY_DEEP=1 pnpm --filter @nibleaf/shared exec vitest run site-route.property
  it.runIf(process.env.NIBLEAF_PROPERTY_DEEP === '1')(
    'agrees on 400 randomized sites (opt-in deep run)',
    () => {
      const { checks, mismatches } = compareOn(400);
      expect(mismatches).toEqual([]);
      expect(checks).toBeGreaterThan(200_000);
    },
    300_000,
  );
});
