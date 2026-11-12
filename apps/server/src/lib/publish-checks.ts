import { INTERFACE_LOCALES } from '@nibleaf/i18n/locales';
import { editor_newgroup } from '@nibleaf/i18n/messages/editor_newgroup';
import { editor_untitled } from '@nibleaf/i18n/messages/editor_untitled';
import { site_importblog } from '@nibleaf/i18n/messages/site_importblog';
import { hasTextOutsideComments } from '@nibleaf/shared/markup-scan';
import { brokenLinkCheckEnabledForSnapshot, findBrokenInternalLinks, snapshotContentFacts } from '@nibleaf/shared/publish-checks';
import { buildNavTree, defaultLanguage, isPageTranslation, publicLanguages, type SiteSnapshot, type SnapshotPage } from '@nibleaf/shared/site';
import { firstPage, pagesForLanguage, pagesForVersion, resolveSitePage } from '@nibleaf/shared/site-route';

/**
 * Pre-publish quality checks, computed from the exact draft snapshot the
 * publish dialog previews. Everything is a warning that leaves publishing
 * allowed, except a broken internal link while the site's broken-link check is
 * on: the publish worker rejects those, so the dialog blocks them up front.
 * Broken links come from `@nibleaf/shared/publish-checks`, the same resolver
 * the worker's gate uses, so the two always agree.
 *
 * One pass over the snapshot's pages with in-memory indexes: no queries, so a
 * 300-page site costs a few milliseconds.
 */
type PublishCheckCode =
  | 'broken-internal-link'
  | 'missing-alt'
  | 'untitled-page'
  | 'stray-characters'
  | 'unreadable-slug'
  | 'empty-page'
  | 'duplicate-title'
  | 'home-untranslated'
  | 'blog-root-group';

export interface PublishCheck {
  code: PublishCheckCode;
  severity: 'error' | 'warning';
  pageId: string;
  languageCode: string;
  title: string;
  path: string;
  /** The evidence: the link, the image source, the stray text, the slug, the
   *  path of the other page with the same title, or (`home-untranslated`) the
   *  language and the page its readers land on as `language|title`. Empty for an
   *  untitled or empty page, or a "Blog" section, where the page is the evidence. */
  detail: string;
  /** Why a link is broken, when it isn't a missing page: too long to serve. */
  reason?: 'path-too-long';
}

/** An over-long link is shown by its start, never in full. */
const TOO_LONG_PREVIEW = 80;

/** A huge site with a systematic problem (every image without alt text) must
 *  not ship a multi-MB preflight. Errors sort first, so they are never cut. */
const MAX_CHECKS = 500;
const MAX_PER_PAGE_AND_CODE = 10;
const MAX_READABLE_SLUG_LENGTH = 80;

/** The placeholder titles the dashboard gives a new page or group, in every
 *  interface locale ("Untitled", "صفحة بدون عنوان", "New group", …). */
const PLACEHOLDER_TITLES = new Set<string>(
  INTERFACE_LOCALES.flatMap(({ code }) => [editor_untitled(undefined, { locale: code }), editor_newgroup(undefined, { locale: code })]).map((title) =>
    title.trim().normalize('NFC'),
  ),
);
const PLACEHOLDER_SLUG = /^(?:untitled|new-group)(?:-\d+)?$/;
/** Slugs that are an id rather than words: cuid/uuid/hex/nanoid shapes and the
 *  importers' `group-9e4c82a8` fallbacks. ASCII only, so Arabic never matches. */
const ID_LIKE_SLUGS = [
  /^c[a-z0-9]{20,}$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[0-9a-f]{12,}$/i,
  /^\d{6,}$/,
  /^(?:page|group|section|doc|untitled|new-group)[-_]?[0-9a-f]{6,}$/i,
];
/** A nanoid-style token: one long run of mixed-case letters and digits. A
 *  long lowercase word with a digit (`ipv6configuration`) is still a word. */
const isRandomToken = (slug: string): boolean => /^[A-Za-z0-9_]{16,}$/.test(slug) && /\d/.test(slug) && /[a-z]/.test(slug) && /[A-Z]/.test(slug);

const normalizeTitle = (title: string): string => title.trim().normalize('NFC');

const isPlaceholderTitle = (title: string): boolean => {
  const normalized = normalizeTitle(title);
  return !normalized || PLACEHOLDER_TITLES.has(normalized);
};

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127);

/** A slug readers can't read: empty, too long, percent-encoded or broken
 *  bytes, or generated (a placeholder or an id). Arabic and other non-Latin
 *  words read fine. */
const isUnreadableSlug = (slug: string): boolean => {
  const value = slug.trim();
  return (
    !value ||
    /%[0-9a-f]{2}/i.test(value) ||
    value.includes(String.fromCharCode(0xff_fd)) ||
    hasControlCharacter(value) ||
    [...value].length > MAX_READABLE_SLUG_LENGTH ||
    PLACEHOLDER_SLUG.test(value) ||
    ID_LIKE_SLUGS.some((pattern) => pattern.test(value)) ||
    isRandomToken(value)
  );
};

/** Whether anything but HTML/MDX comments and whitespace is left: nothing here
 *  is rendered, it only decides whether a page is empty. One forward read
 *  (`hasTextOutsideComments`), the same answer as splitting on the comments. */
const hasBody = hasTextOutsideComments;

const SEVERITY_ORDER = { error: 0, warning: 1 } as const;

/** The title the Ghost importer gives a site's posts ("Blog", "المدونة", …), in
 *  every interface locale. */
const IMPORTED_BLOG_TITLES = new Set<string>(
  INTERFACE_LOCALES.map(({ code }) => site_importblog(undefined, { locale: code }).trim().normalize('NFC').toLocaleLowerCase()),
);

/**
 * Checks about the site as readers enter it, in its default version:
 * - `home-untranslated`: readers who open the site in another language land on
 *   a page that isn't a translation of the home page. Where they land is asked
 *   of the reader's own route resolution (`resolveSitePage` with an empty path),
 *   so the warning clears exactly when the landing page changes. One per
 *   language, on the home page; the detail is JSON with the language, the page
 *   they land on, and the home page's translation key and path, so the dialog
 *   can name the exact change.
 * - `blog-root-group`: the first section of a language's navigation is the
 *   importer's "Blog", so every docs page reads as a blog post in the sidebar
 *   and the breadcrumbs.
 */
const siteStructureChecks = (
  snapshot: SiteSnapshot,
  served: ReadonlySet<string>,
  add: (page: SnapshotPage, code: PublishCheckCode, detail?: string) => void,
): void => {
  const version = snapshot.project.versions.find((candidate) => candidate.isDefault);
  if (!version) return;
  const versionPages = pagesForVersion(snapshot, version);
  const defaultCode = defaultLanguage(snapshot.project).code;
  const home = firstPage(pagesForLanguage(versionPages, defaultCode), defaultCode);
  for (const code of served) {
    const pages = pagesForLanguage(versionPages, code);
    const nav = buildNavTree(pages, code);
    const first = nav[0];
    const firstGroup = first && first.kind === 'GROUP' ? pages.find((page) => page.id === first.id) : undefined;
    if (firstGroup && IMPORTED_BLOG_TITLES.has(firstGroup.title.trim().normalize('NFC').toLocaleLowerCase())) add(firstGroup, 'blog-root-group');
    if (!home || code === defaultCode) continue;
    // Only a language with pages of its own: otherwise readers get the default language's home.
    if (!firstPage(pages, code)) continue;
    const landing = resolveSitePage(snapshot, '', code, version.slug)?.page;
    if (!landing || landing.languageCode !== code || isPageTranslation(home, landing)) continue;
    add(home, 'home-untranslated', JSON.stringify({ language: code, landing: landing.title, key: home.translationKey ?? null, path: home.path }));
  }
};

/** Every check for the snapshot, errors first, then in page order. */
export function collectPublishChecks(snapshot: SiteSnapshot): PublishCheck[] {
  const served = new Set(publicLanguages(snapshot.project.languages).map((language) => language.code));
  // Hidden pages and disabled languages are not published, so nothing on them can mislead a reader.
  const published = snapshot.pages.filter((page) => !page.hidden && served.has(page.languageCode));
  const linkSeverity = brokenLinkCheckEnabledForSnapshot(snapshot) ? 'error' : 'warning';
  // Shared with findBrokenInternalLinks below, so each page is parsed once per snapshot.
  const factsOf = snapshotContentFacts(snapshot);
  const brokenLinks = new Map<string, string[]>();
  const tooLong = new Set<string>();
  for (const { page, href, reason } of findBrokenInternalLinks(snapshot)) {
    const hrefs = brokenLinks.get(page.id) ?? [];
    const detail = reason === 'path-too-long' ? `${href.slice(0, TOO_LONG_PREVIEW)}…` : href;
    if (reason === 'path-too-long') tooLong.add(detail);
    hrefs.push(detail);
    brokenLinks.set(page.id, hrefs);
  }
  const checks: PublishCheck[] = [];
  const add = (page: SnapshotPage, code: PublishCheckCode, detail = '', severity: PublishCheck['severity'] = 'warning') =>
    checks.push({
      code,
      severity,
      pageId: page.id,
      languageCode: page.languageCode,
      title: page.title,
      path: page.path,
      detail,
      ...(code === 'broken-internal-link' && tooLong.has(detail) ? { reason: 'path-too-long' as const } : {}),
    });
  const addEach = (page: SnapshotPage, code: PublishCheckCode, details: readonly string[], severity?: PublishCheck['severity']) => {
    for (const detail of [...new Set(details)].slice(0, MAX_PER_PAGE_AND_CODE)) add(page, code, detail, severity);
  };

  const siblingsByTitle = new Map<string, SnapshotPage[]>();
  for (const page of published) {
    if (isPlaceholderTitle(page.title)) {
      add(page, 'untitled-page');
    } else {
      const key = [page.versionId, page.languageCode, page.parentId ?? '', normalizeTitle(page.title).toLocaleLowerCase()].join('\u0000');
      const siblings = siblingsByTitle.get(key) ?? [];
      siblings.push(page);
      siblingsByTitle.set(key, siblings);
    }
    if (isUnreadableSlug(page.slug)) add(page, 'unreadable-slug', page.slug);
    if (page.kind !== 'PAGE') continue;
    // No shortcut for an empty page: every finding is still reported, so the
    // dialog can never hide a link the worker would block on.
    if (!hasBody(page.content)) add(page, 'empty-page');
    const facts = factsOf(page.content);
    addEach(page, 'broken-internal-link', brokenLinks.get(page.id) ?? [], linkSeverity);
    addEach(page, 'missing-alt', facts.imagesWithoutAlt);
    addEach(page, 'stray-characters', facts.strayText);
  }
  for (const siblings of siblingsByTitle.values()) {
    if (siblings.length < 2) continue;
    for (const page of siblings) {
      const other = siblings.find((candidate) => candidate.id !== page.id);
      add(page, 'duplicate-title', other?.path ?? '');
    }
  }
  siteStructureChecks(snapshot, served, add);

  return checks.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).slice(0, MAX_CHECKS);
}
