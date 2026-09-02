import { defaultLanguage, pageDescription, type SiteSnapshot, type SnapshotPage } from '@nibleaf/shared/site';

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

/** Every AI-consumable page: real pages only, not hidden, not noindex, not
 *  externally canonicalized, and not in a language whose own SEO disallows
 *  indexing. Same rules as the sitemap. */
export const llmsIndexablePages = (snapshot: SiteSnapshot): SnapshotPage[] => {
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

/** Absolute URL of a page, matching the sitemap's shape: default language gets
 *  the clean (param-less) canonical URL, non-default versions get a path prefix. */
export const llmsPageUrl = (snapshot: SiteSnapshot, page: SnapshotPage, base: string): string => {
  const defaultCode = defaultLanguage(snapshot.project).code;
  const pageVersion = snapshot.project.versions.find((version) => version.id === page.versionId);
  if (!pageVersion) {
    throw new Error(`Snapshot page ${page.id} references an unknown version.`);
  }
  const versionPath = !pageVersion.isDefault ? `/${encodeURIComponent(pageVersion.slug)}` : '';
  // Slugs may be non-ASCII (Arabic titles keep Arabic slugs); encode each
  // segment so the URL is a valid ASCII link in a Markdown list.
  const pagePath = page.path ? `/${page.path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}` : '';
  const langQuery = page.languageCode !== defaultCode ? `?lang=${encodeURIComponent(page.languageCode)}` : '';
  return `${base}${versionPath}${pagePath}${langQuery}`;
};

/** Collapse a description to a single Markdown-safe line. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

const siteHeader = (snapshot: SiteSnapshot): string[] => {
  const lines = [`# ${oneLine(snapshot.project.name)}`];
  const description = snapshot.project.description?.trim();
  if (description) {
    lines.push('', `> ${oneLine(description)}`);
  }
  return lines;
};

/** llms.txt: site title + description, then a Markdown link list of every
 *  indexable page (grouped per language when the site has more than one). */
export const buildLlmsTxt = (snapshot: SiteSnapshot, base: string): string => {
  const pages = llmsIndexablePages(snapshot);
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
      lines.push(`- [${oneLine(page.title)}](${llmsPageUrl(snapshot, page, base)})${description ? `: ${description}` : ''}`);
    }
  }
  return `${lines.join('\n')}\n`;
};

/** llms-full.txt: the full Markdown of every indexable page, concatenated with
 *  a per-page header and source URL so consumers can attribute content. */
export const buildLlmsFullTxt = (snapshot: SiteSnapshot, base: string): string => {
  const sections = llmsIndexablePages(snapshot).map((page) => {
    const header = [`# ${oneLine(page.title)}`, '', `Source: ${llmsPageUrl(snapshot, page, base)}`];
    const description = page.description?.trim();
    if (description) {
      header.push('', `> ${oneLine(description)}`);
    }
    return `${header.join('\n')}\n\n${page.content.trim()}\n`;
  });
  return [...siteHeader(snapshot), '', sections.join('\n---\n\n')].join('\n');
};
