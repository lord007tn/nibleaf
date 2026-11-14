import { markdownAlternateUrl } from '@nibleaf/shared/markdown-discovery';
import { excerpt, pageDescription } from '@nibleaf/shared/markdown-text';
import { displayTitle } from '@nibleaf/shared/page-title';
import { defaultLanguage, type SiteSnapshot, type SnapshotPage } from '@nibleaf/shared/site';
import { publishedSitePath } from '@nibleaf/shared/site-language';

/**
 * Pure builders for a published site's llms.txt / llms-full.txt — the
 * llmstxt.org convention that lets AI crawlers and assistants consume docs as
 * plain Markdown instead of scraping HTML. Mintlify meters this; we ship it
 * free on every published site.
 *
 * Page filtering and URL shapes mirror the sitemap exactly: hidden pages,
 * noindex pages, and languages whose SEO disallows indexing are excluded, and
 * URLs are built on `${base}` (`APP_URL/sites/:id`) so the app edge can rebase
 * them onto a custom domain with the same regex it uses for sitemap.xml.
 */

/** Options for the documents served to a signed-in reader of a private site. */
export interface LlmsOptions {
  /** A private site: every page the viewer can read that isn't hidden. Search
   *  indexing rules (noindex, canonical, allowIndex) are about public search
   *  results and don't apply behind sign-in. */
  privateSite?: boolean;
}

/** Every AI-consumable page: real pages only, not hidden, not noindex, not
 *  externally canonicalized, and not in a language whose own SEO disallows
 *  indexing. Same rules as the sitemap. On a private site, every readable page
 *  that isn't hidden (the snapshot is already limited to the viewer's grants,
 *  and ungranted ancestors are navigation-only groups without a body). */
export const llmsIndexablePages = (snapshot: SiteSnapshot, options: LlmsOptions = {}): SnapshotPage[] => {
  if (options.privateSite) return snapshot.pages.filter((page) => page.kind === 'PAGE' && !page.hidden);
  const blockedLangs = new Set(snapshot.project.languages.filter((l) => l.config?.seo?.allowIndex === false).map((l) => l.code));
  return snapshot.pages.filter(
    (page) =>
      page.kind === 'PAGE' &&
      !page.hidden &&
      !page.config?.seo?.noindex &&
      !page.config?.seo?.canonicalUrl?.trim() &&
      !blockedLangs.has(page.languageCode),
  );
};

/** Absolute URL of a page's Markdown alternate. Its path mirrors the sitemap's
 * canonical HTML URL and appends `.md`; query parameters remain intact. */
export const llmsPageUrl = (snapshot: SiteSnapshot, page: SnapshotPage, base: string): string => {
  const defaultCode = defaultLanguage(snapshot.project).code;
  const pageVersion = snapshot.project.versions.find((version) => version.id === page.versionId);
  if (!pageVersion) {
    throw new Error(`Snapshot page ${page.id} references an unknown version.`);
  }
  return markdownAlternateUrl(
    `${base}${publishedSitePath(page.path, page.languageCode === defaultCode ? undefined : page.languageCode, pageVersion.isDefault ? undefined : pageVersion.slug)}`,
  );
};

/** Collapse a description to a single Markdown-safe line. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

const siteHeader = (snapshot: SiteSnapshot): string[] => {
  const lines = [`# ${oneLine(snapshot.project.name)}`];
  const description = snapshot.project.description?.trim();
  if (description) {
    lines.push('', `> ${excerpt(description)}`);
  }
  return lines;
};

/** llms.txt: site title + description, then a Markdown link list of every
 *  indexable page (grouped per language when the site has more than one). */
export const buildLlmsTxt = (snapshot: SiteSnapshot, base: string, options: LlmsOptions = {}): string => {
  const pages = llmsIndexablePages(snapshot, options);
  const lines = siteHeader(snapshot);

  const languages = snapshot.project.languages;

  for (const language of languages) {
    const langPages = pages.filter((page) => page.languageCode === language.code);
    if (langPages.length === 0) {
      continue;
    }
    lines.push('', languages.length > 1 ? `## Docs (${oneLine(language.label)})` : '## Docs', '');
    for (const page of langPages) {
      const description = oneLine(pageDescription(page));
      lines.push(`- [${oneLine(displayTitle(page))}](${llmsPageUrl(snapshot, page, base)})${description ? `: ${description}` : ''}`);
    }
  }
  return `${lines.join('\n')}\n`;
};

/** llms-full.txt: the full Markdown of every indexable page, concatenated with
 *  a per-page header and source URL so consumers can attribute content. */
export const buildLlmsFullTxt = (snapshot: SiteSnapshot, base: string, options: LlmsOptions = {}): string => {
  const sections = llmsIndexablePages(snapshot, options).map((page) => {
    const header = [`# ${oneLine(displayTitle(page))}`, '', `Source: ${llmsPageUrl(snapshot, page, base)}`];
    const description = page.config?.seo?.metaDescription?.trim() || page.description?.trim();
    if (description) {
      header.push('', `> ${excerpt(description)}`);
    }
    return `${header.join('\n')}\n\n${page.content.trim()}\n`;
  });
  return [...siteHeader(snapshot), '', sections.join('\n---\n\n')].join('\n');
};
