/** @vitest-environment jsdom */
import { findBrokenInternalLinks } from '@nibleaf/shared/publish-checks';
import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { parseSiteLanguageAlias, parseSiteLanguagePath } from '@nibleaf/shared/site-language';
import { sitePathLanguages } from '@nibleaf/shared/site-language-policy';
import { resolveSitePage } from '@nibleaf/shared/site-route';
import { normalizeRedirectPath, resolveRedirectTarget } from '@nibleaf/validators/redirects';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RichMarkdown from '@/components/markdown-rich';
import { buildSiteRedirectHref } from '@/lib/site-redirect-href';

/**
 * The pre-publish link check against the READER, independently: each link is
 * rendered by the reader's own Markdown renderer (with the page's link
 * context), then followed through the page route's steps using the reader's
 * own helpers: getSitePage's lookup, the API reference path, configured
 * redirects (as `redirectIfConfigured`), then the language-prefix redirect
 * (`resolveLanguagePathRedirect`). The check must call a link broken exactly
 * when the reader ends on its not-found page.
 */

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

const TARGETS = [
  page({ path: 'guide' }),
  page({ path: 'setup' }),
  page({ path: 'reference/limits' }),
  page({ path: 'guide', languageCode: 'ar', title: 'دليل' }),
  page({ path: 'guide', versionId: 'v2' }),
  page({ path: 'v2-only', versionId: 'v2' }),
  page({ path: 'guide', versionId: 'v2', languageCode: 'ar' }),
];

const snapshotWith = (linking: SnapshotPage): SiteSnapshot => ({
  project: {
    id: 'project-1',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    config: { redirects: [{ from: '/ar/old', to: '/guide' }] },
    languages: [
      { code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null },
      { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, config: null },
    ],
    versions: [
      { id: 'v1', name: 'Latest', slug: 'latest', isDefault: true },
      { id: 'v2', name: 'v2', slug: 'v2', isDefault: false },
    ],
  },
  pages: [linking, ...TARGETS],
  openapi: { title: 'API', path: 'api', contentHash: 'h', updatedAt: '2026-11-01T00:00:00.000Z', document: {} },
  generatedAt: '2026-11-01T00:00:00.000Z',
});

const ORIGIN = 'https://docs.test';

/** The reader's `?lang=` search param (`z.string().min(1).optional().catch(undefined)`). */
const readerLang = (url: URL): string | undefined => {
  const values = url.searchParams.getAll('lang');
  return values.length === 1 && values[0] ? values[0] : undefined;
};

/** Follow the page route for `url`: what the reader ends on. */
const readerServes = (snapshot: SiteSnapshot, start: URL): 'page' | 'openapi' | 'external' | 'not-found' => {
  let url = start;
  for (let hop = 0; hop <= 10; hop++) {
    const parsed = parseSiteLanguagePath(
      decodeURIComponent(url.pathname),
      readerLang(url) && snapshot.project.languages.some((item) => item.code === readerLang(url)) ? [] : sitePathLanguages(snapshot),
    );
    const splat = parsed.path;
    const lang = parsed.language?.code ?? readerLang(url);
    // 1. The page API (getSitePage): the first segment is passed as the version.
    if (resolveSitePage(snapshot, splat, lang, splat ? splat.split('/')[0] : undefined)) return 'page';
    // 2. The API reference.
    if (snapshot.openapi && splat === snapshot.openapi.path) return 'openapi';
    // 3. A configured redirect (redirectIfConfigured).
    const redirects = (snapshot.project.config as { redirects: { from: string; to: string }[] }).redirects;
    const to =
      resolveRedirectTarget(redirects, normalizeRedirectPath(splat)) ??
      resolveRedirectTarget(redirects, normalizeRedirectPath(decodeURIComponent(url.pathname)));
    if (to) {
      if (/^https?:\/\//i.test(to)) return 'external';
      url = new URL(buildSiteRedirectHref({ projectId: snapshot.project.id, target: to, lang, customDomain: true }), ORIGIN);
      continue;
    }
    const alias = parseSiteLanguageAlias(splat, snapshot.project.languages);
    if (alias.language) {
      const prefix = sitePathLanguages(snapshot).find((item) => item.code === alias.language?.code)?.pathPrefix;
      url = new URL(`/${alias.language.isDefault ? '' : `${prefix}/`}${alias.path}`, ORIGIN);
      continue;
    }
    return 'not-found';
  }
  return 'not-found';
};

/** The internal hrefs the reader renders for `linking`, as absolute URLs. */
const renderedLinks = (snapshot: SiteSnapshot, linking: SnapshotPage): URL[] => {
  const version = snapshot.project.versions.find((candidate) => candidate.id === linking.versionId);
  const versionPrefix = version && !version.isDefault ? version.slug : undefined;
  const pageUrl = new URL(
    `/${[versionPrefix, linking.path].filter(Boolean).join('/')}${linking.languageCode === 'en' ? '' : `?lang=${linking.languageCode}`}`,
    ORIGIN,
  );
  const html = renderToStaticMarkup(
    createElement(RichMarkdown, {
      content: linking.content,
      site: {
        projectId: snapshot.project.id,
        lang: linking.languageCode,
        defaultLanguage: 'en',
        version: versionPrefix,
        path: linking.path,
        languages: sitePathLanguages(snapshot),
      },
    }),
  );
  const document = new DOMParser().parseFromString(html, 'text/html');
  return [...document.querySelectorAll('a[href]')]
    .map((anchor) => anchor.getAttribute('href') ?? '')
    .filter((href) => href && !href.startsWith('#'))
    .map((href) => new URL(href, pageUrl))
    .filter((url) => url.origin === ORIGIN);
};

describe('pre-publish link check vs the reader', () => {
  it.each<[string, Partial<SnapshotPage>, string, 'reached' | 'broken']>([
    // Versions and languages combined (the reader only reads a language prefix in the first segment).
    ['a language prefix after a version prefix', {}, '/v2/ar/guide', 'broken'],
    ['a language prefix', {}, '/ar/guide', 'reached'],
    ['a version prefix', {}, '/v2/guide', 'reached'],
    ['a group prefix', {}, '/reference', 'reached'],
    ['an unknown ?lang=, through the default language', {}, '/guide?lang=zz', 'reached'],
    ['a configured redirect for a full language-prefixed path', {}, '/ar/old', 'reached'],
    ['the default-language prefix', {}, '/en/setup', 'reached'],
    ['the API reference', {}, '/api', 'reached'],
    ['the site root', {}, '/', 'reached'],
    ['an anchor on an existing page', {}, '/guide#install', 'reached'],
    ['a relative link', {}, 'setup', 'reached'],
    ['a relative link into a group', {}, 'reference/limits', 'reached'],
    ['a missing page', {}, '/configuration', 'broken'],
    ['a missing page behind a language prefix', {}, '/ar/missing', 'broken'],
    ['an Arabic page, to an English-only page (default-language fallback)', { languageCode: 'ar' }, '/setup', 'reached'],
    ['an Arabic page, to its own translation', { languageCode: 'ar' }, '/guide', 'reached'],
    ['a v2 page, inside its version', { versionId: 'v2' }, '/v2-only', 'reached'],
    ['a v2 page, to a page only in the default version', { versionId: 'v2' }, '/setup', 'broken'],
    ['a v2 page, relative', { versionId: 'v2' }, 'guide', 'reached'],
  ])('%s: %s', (_case, linkingPage, href, expected) => {
    const linking = page({ path: 'start', content: `See [the target](${href}).`, ...linkingPage });
    const snapshot = snapshotWith(linking);

    const rendered = renderedLinks(snapshot, linking);
    expect(rendered).toHaveLength(1);
    const reader = readerServes(snapshot, rendered[0] as URL);
    expect(reader === 'not-found' ? 'broken' : 'reached').toBe(expected);

    const flagged = findBrokenInternalLinks(snapshot).map((link) => link.href);
    expect(flagged).toEqual(expected === 'broken' ? [href] : []);
  });

  it.each<[string, string]>([
    ['a link inside code', 'Run `[a](/missing-code)` here.\n\n```\n[b](/missing-fence)\n```\n\n    [c](/missing-indented)'],
    ['a link inside an HTML comment', '<!-- [a](/missing-comment) -->'],
    ['an unused reference definition', 'Text.\n\n[unused]: /missing-definition'],
    ['a footnote', 'A claim.[^1]\n\n[^1]: Source text'],
  ])('renders no link for %s, and the check reports none', (_case, content) => {
    const linking = page({ path: 'start', content });
    const snapshot = snapshotWith(linking);
    expect(renderedLinks(snapshot, linking).map((url) => url.pathname)).toEqual([]);
    expect(findBrokenInternalLinks(snapshot)).toEqual([]);
  });

  it('renders the link of a used reference, a link between escaped backticks and one in a table cell, and the check judges all three', () => {
    const linking = page({
      path: 'start',
      content: 'See [it][ref] and \\`[b](/missing-escaped)\\`.\n\n| a | b |\n| - | - |\n| [c](/missing-cell) | d |\n\n[ref]: /missing-reference',
    });
    const snapshot = snapshotWith(linking);
    const rendered = renderedLinks(snapshot, linking).map((url) => url.pathname);
    expect(rendered).toEqual(['/missing-reference', '/missing-escaped', '/missing-cell']);
    expect(rendered.map((path) => readerServes(snapshot, new URL(path, ORIGIN)))).toEqual(['not-found', 'not-found', 'not-found']);
    expect(findBrokenInternalLinks(snapshot).map((link) => link.href)).toEqual(['/missing-reference', '/missing-escaped', '/missing-cell']);
  });
});
