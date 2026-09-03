import path from 'node:path';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from '@nibleaf/shared/public-markdown-content';
import {
  defaultLanguage,
  extractHeadings,
  isPageTranslation,
  pageDescription,
  publicLanguages,
  type SiteSnapshot,
  type SnapshotLanguage,
  type SnapshotPage,
} from '@nibleaf/shared/site';
import {
  resolveTheme,
  safeThemeFontFamily,
  safeThemeHex,
  THEME_SCHEMA_VERSION,
  type ThemeColorTokens,
  type ThemeOwnedProjectConfig,
  themeOwnedConfig,
  themeTemplateFromConfig,
} from '@nibleaf/shared/themes';
import { strToU8, zipSync } from 'fflate';
import { Marked } from 'marked';
import { z } from 'zod';

export interface ExportAsset {
  key: string;
  url: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface ExportAssetManifestItem {
  key: string;
  url: string;
  contentType: string;
  size: number;
}

/** Select only assets referenced by published data and reject oversized jobs
 * before reading object bodies into worker memory. */
export const selectPublishedAssets = (snapshot: SiteSnapshot, manifest: ExportAssetManifestItem[], maxBytes: number): ExportAssetManifestItem[] => {
  const published = JSON.stringify(snapshot);
  const referenced = manifest.filter((asset) => published.includes(asset.url) || published.includes(asset.key));
  const declaredBytes = referenced.reduce((total, asset) => total + asset.size, 0);
  if (declaredBytes > maxBytes) throw new Error(`Export assets exceed the ${maxBytes}-byte limit.`);
  return referenced;
};

export interface RenderedArtifact {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
}

const encoder = new TextEncoder();
const escapeHtml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const safeSegment = (value: string): string =>
  value
    .replace(/[\\/]+/g, '-')
    .replace(/\.\.+/g, '.')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: archive entry hardening
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .trim() || 'untitled';
const safePath = (value: string): string => value.split('/').map(safeSegment).filter(Boolean).join('/') || 'index';

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    // Published Markdown may contain MDX/HTML. Static exports display unknown
    // markup as source instead of executing scripts or event handlers.
    html(token) {
      return escapeHtml(token.text);
    },
  },
});

const versionFor = (snapshot: SiteSnapshot, page: SnapshotPage) => snapshot.project.versions.find((version) => version.id === page.versionId);
const outputPath = (snapshot: SiteSnapshot, page: SnapshotPage): string =>
  `${safeSegment(versionFor(snapshot, page)?.slug ?? 'main')}/${safeSegment(page.languageCode)}/${safePath(page.path)}/index.html`;
const outputMarkdownPath = (snapshot: SiteSnapshot, page: SnapshotPage): string => outputPath(snapshot, page).replace(/index\.html$/u, 'index.md');

const splitSuffix = (href: string): [string, string] => {
  const index = href.search(/[?#]/);
  return index < 0 ? [href, ''] : [href.slice(0, index), href.slice(index)];
};

const resolvePageTarget = (snapshot: SiteSnapshot, page: SnapshotPage, href: string): SnapshotPage | undefined => {
  const [raw] = splitSuffix(href);
  const current = page.path.split('/').slice(0, -1);
  const normalized = path.posix
    .normalize(raw.startsWith('/') ? raw : [...current, raw].join('/'))
    .replace(/^\/+/, '')
    .replace(/\/(?:index\.html?)?$/i, '')
    .replace(/\.(?:mdx?|html?)$/i, '');
  return snapshot.pages.find(
    (candidate) =>
      candidate.kind === 'PAGE' &&
      candidate.versionId === page.versionId &&
      candidate.languageCode === page.languageCode &&
      candidate.path.replace(/^\/+|\/+$/g, '') === normalized,
  );
};

const assetName = (asset: Pick<ExportAsset, 'key'>): string => `assets/${safeSegment(asset.key.split('/').at(-1) ?? asset.key)}`;

const rewriteUrl = (
  snapshot: SiteSnapshot,
  page: SnapshotPage,
  currentOutput: string,
  rawUrl: string,
  assets: ExportAsset[],
  kind: 'link' | 'image',
): string => {
  const url = rawUrl.trim();
  if (!url || url.startsWith('#')) return url;
  if (/^(?:javascript|data:text\/html|vbscript):/i.test(url)) return '#';
  const asset = assets.find((candidate) => url === candidate.url || url === `/${candidate.key}` || url.includes(candidate.key));
  if (asset) return path.posix.relative(path.posix.dirname(currentOutput), assetName(asset)) || './';
  if (kind === 'image' || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return url;
  const target = resolvePageTarget(snapshot, page, url);
  if (!target) return url;
  const [, suffix] = splitSuffix(url);
  return `${path.posix.relative(path.posix.dirname(currentOutput), outputPath(snapshot, target)) || './'}${suffix}`;
};

export const renderPageMarkdown = (snapshot: SiteSnapshot, page: SnapshotPage, assets: ExportAsset[]): string => {
  const current = outputPath(snapshot, page);
  const html = String(marked.parse(portablePublicMdxMarkdown(page.content)));
  return html
    .replace(
      /(<a\b[^>]*\bhref=")([^"]*)(")/gi,
      (_all, before, url, after) => `${before}${escapeHtml(rewriteUrl(snapshot, page, current, url, assets, 'link'))}${after}`,
    )
    .replace(
      /(<img\b[^>]*\bsrc=")([^"]*)(")/gi,
      (_all, before, url, after) => `${before}${escapeHtml(rewriteUrl(snapshot, page, current, url, assets, 'image'))}${after}`,
    );
};

const LEGACY_LIGHT = {
  canvas: '#ffffff',
  foreground: '#172033',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  muted: '#f5f6f8',
  mutedForeground: '#667085',
  border: '#d8dee9',
  accent: '#5b4be8',
  accentForeground: '#ffffff',
  focus: '#5b4be8',
  code: '#f5f6f8',
  codeForeground: '#172033',
  info: '#5b4be8',
  success: '#15803d',
  warning: '#b45309',
  danger: '#b91c1c',
} satisfies ThemeColorTokens;
const LEGACY_DARK = {
  ...LEGACY_LIGHT,
  canvas: '#10131a',
  foreground: '#ecedf1',
  surface: '#191e28',
  surfaceRaised: '#191e28',
  muted: '#191e28',
  mutedForeground: '#a6adbb',
  border: '#303642',
  code: '#191e28',
  codeForeground: '#ecedf1',
} satisfies ThemeColorTokens;

const declarations = (tokens: ThemeColorTokens, fallback: ThemeColorTokens): string =>
  [
    `--bg:${safeThemeHex(tokens.canvas, fallback.canvas)}`,
    `--fg:${safeThemeHex(tokens.foreground, fallback.foreground)}`,
    `--surface:${safeThemeHex(tokens.surface, fallback.surface)}`,
    `--muted-surface:${safeThemeHex(tokens.muted, fallback.muted)}`,
    `--muted:${safeThemeHex(tokens.mutedForeground, fallback.mutedForeground)}`,
    `--line:${safeThemeHex(tokens.border, fallback.border)}`,
    `--accent:${safeThemeHex(tokens.accent, fallback.accent)}`,
    `--accent-fg:${safeThemeHex(tokens.accentForeground, fallback.accentForeground)}`,
    `--focus:${safeThemeHex(tokens.focus, fallback.focus)}`,
    `--code:${safeThemeHex(tokens.code, fallback.code)}`,
    `--code-fg:${safeThemeHex(tokens.codeForeground, fallback.codeForeground)}`,
    `--info:${safeThemeHex(tokens.info, fallback.info)}`,
    `--success:${safeThemeHex(tokens.success, fallback.success)}`,
    `--warning:${safeThemeHex(tokens.warning, fallback.warning)}`,
    `--danger:${safeThemeHex(tokens.danger, fallback.danger)}`,
  ].join(';');

const themeConfigOf = (snapshot: SiteSnapshot): ThemeOwnedProjectConfig => themeOwnedConfig(snapshot.project.config);

const safeCssNumber = (value: unknown, fallback: number, minimum: number, maximum: number): string => {
  const parsed = z.coerce.number().safeParse(value);
  const numeric = parsed.success ? parsed.data : Number.NaN;
  return Number.isFinite(numeric) && numeric >= minimum && numeric <= maximum ? String(numeric) : String(fallback);
};

const exportThemeCss = (snapshot: SiteSnapshot, print = false): string => {
  const config = themeConfigOf(snapshot);
  const theme = resolveTheme(config);
  const preset = resolveTheme({ theme: { preset: theme.id } });
  const explicit = Boolean(config.theme);
  const light = explicit ? theme.colors.light : LEGACY_LIGHT;
  const dark = explicit ? theme.colors.dark : LEGACY_DARK;
  const lightFallback = explicit ? preset.colors.light : LEGACY_LIGHT;
  const darkFallback = explicit ? preset.colors.dark : LEGACY_DARK;
  const appearance = explicit ? (config.styling?.theme ?? 'system') : 'system';
  const initial = !print && appearance === 'dark' ? declarations(dark, darkFallback) : declarations(light, lightFallback);
  const darkRule = !print && appearance === 'system' ? `@media(prefers-color-scheme:dark){:root{${declarations(dark, darkFallback)}}}` : '';
  const radius = theme.layout.radius === 'sharp' ? '2px' : theme.layout.radius === 'pill' ? '16px' : '8px';
  const contentMax = theme.layout.contentWidth === 'focused' ? '1120px' : theme.layout.contentWidth === 'wide' ? '1520px' : '1240px';
  const sidebarWidth = theme.layout.density === 'compact' ? '250px' : theme.layout.density === 'relaxed' ? '300px' : '280px';
  const typography = config.typography;
  const defaultFontSize = theme.layout.density === 'compact' ? 15 : theme.layout.density === 'relaxed' ? 17 : 16;
  const defaultLeading = theme.layout.density === 'compact' ? 1.6 : theme.layout.density === 'relaxed' ? 1.9 : 1.75;
  const defaultFlow = theme.layout.density === 'compact' ? 1 : theme.layout.density === 'relaxed' ? 1.5 : 1.25;
  const fontSize = `${safeCssNumber(typography?.baseSize, defaultFontSize, 12, 24)}px`;
  const leading = safeCssNumber(typography?.leading, defaultLeading, 1, 3);
  const flow = `${safeCssNumber(typography?.flow, defaultFlow, 0.5, 4)}em`;
  const bodyFont = safeThemeFontFamily(typography?.bodyFont);
  const headingFont = safeThemeFontFamily(typography?.headingFont);
  const codeFont = safeThemeFontFamily(typography?.codeFont);
  const bodyStack = bodyFont
    ? `'${bodyFont}',"Noto Sans Arabic","Segoe UI",system-ui,sans-serif`
    : 'system-ui,-apple-system,"Segoe UI","Noto Sans Arabic",Arial,sans-serif';
  const headingStack = headingFont ? `'${headingFont}',"Noto Sans Arabic","Segoe UI",system-ui,sans-serif` : 'var(--font-body)';
  const codeStack = codeFont ? `'${codeFont}',ui-monospace,"Cascadia Code",monospace` : 'ui-monospace,"Cascadia Code",monospace';
  return `
:root{color-scheme:${print || appearance === 'light' ? 'light' : appearance === 'dark' ? 'dark' : 'light dark'};${initial};--radius:${radius};--content-max:${contentMax};--sidebar-width:${sidebarWidth};--font-size:${fontSize};--font-body:${bodyStack};--font-heading:${headingStack};--font-code:${codeStack};--leading:${leading};--flow:${flow}}${darkRule}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:5rem}body{margin:0;background:var(--bg);color:var(--fg);font:var(--font-size)/var(--leading) var(--font-body)}:is(h1,h2,h3,h4,h5,h6){font-family:var(--font-heading);text-wrap:balance}main :is(p,pre,table,blockquote){margin-block:var(--flow)}a{color:var(--accent)}:is(a,input,button,pre):focus-visible{outline:3px solid var(--focus);outline-offset:3px}.brand{color:var(--fg);font-weight:780;letter-spacing:-.02em;text-decoration:none}.meta{color:var(--muted);font-size:.82rem}.search{width:100%;min-height:42px;padding:9px 12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);color:var(--fg)}.nav a{color:var(--fg);text-decoration:none}.nav .active{color:var(--accent);font-weight:720}.article{min-width:0}.article-header{padding-block:2rem 1rem}.article-header h1{font-size:clamp(2rem,5vw,3.5rem);line-height:1.08;margin:0}.article-description{color:var(--muted);font-size:1.05rem}.prose{overflow-wrap:anywhere}.prose img{max-width:100%;height:auto;border-radius:var(--radius)}.prose pre{overflow:auto;padding:16px;border:1px solid var(--line);border-radius:var(--radius);background:var(--code);color:var(--code-fg);direction:ltr;text-align:left}.prose code{font-family:var(--font-code)}.prose table{display:block;max-width:100%;overflow:auto;border-collapse:collapse}.prose :is(th,td){border:1px solid var(--line);padding:8px 12px;text-align:start}.prose blockquote{border-inline-start:4px solid var(--info);margin-inline:0;padding:12px 16px;color:var(--muted);background:color-mix(in oklab,var(--info) 9%,transparent)}.toc{font-size:.84rem}.toc ol{list-style:none;margin:0;padding:0}.toc a{display:block;padding-block:.25rem;color:var(--muted);text-decoration:none}.toc a:hover{color:var(--accent)}.toc .depth-3{padding-inline-start:1rem}.pager{display:flex;justify-content:space-between;gap:1rem;margin-top:4rem;padding-top:1.5rem;border-top:1px solid var(--line)}.pager a{max-width:48%;text-decoration:none}.search-status:empty{visibility:hidden;height:0;padding:0}.search-status{display:block;padding-block:.75rem;color:var(--muted);font-variant-numeric:tabular-nums}
/* Harbor: a three-column reference library with a persistent top utility bar. */
.harbor-topbar{position:sticky;z-index:20;top:0;display:grid;grid-template-columns:var(--sidebar-width) minmax(16rem,1fr) auto;align-items:center;gap:2rem;min-height:68px;padding-inline:max(1.5rem,calc((100vw - var(--content-max))/2 + 1.5rem));border-bottom:1px solid var(--line);background:color-mix(in oklab,var(--bg) 92%,transparent);backdrop-filter:blur(14px)}.harbor-topbar .search-wrap{max-width:34rem}.harbor-edition{white-space:nowrap}.harbor-shell{display:grid;grid-template-columns:var(--sidebar-width) minmax(0,780px) minmax(160px,220px);gap:clamp(1.5rem,4vw,3.5rem);max-width:var(--content-max);margin:auto;padding:0 1.5rem}.harbor-library{position:sticky;top:68px;height:calc(100vh - 68px);overflow:auto;padding:2rem 1.25rem 4rem 0;border-inline-end:1px solid var(--line)}[dir="rtl"] .harbor-library{padding:2rem 0 4rem 1.25rem}.harbor-library .nav{display:grid;gap:.18rem}.harbor-library .nav a{padding:.42rem .65rem;border-radius:calc(var(--radius)/1.5)}.harbor-library .nav a:hover,.harbor-library .nav .active{background:var(--muted-surface)}.harbor-article{padding-bottom:6rem}.harbor-toc{position:sticky;top:92px;align-self:start;max-height:calc(100vh - 116px);overflow:auto;padding-top:2rem}
/* Manuscript: an editorial masthead, horizontal chapters, and centered paper. */
.manuscript-masthead{padding:2rem max(1.25rem,calc((100vw - var(--content-max))/2 + 1.25rem)) 1rem;border-bottom:1px solid var(--line)}.manuscript-masthead-row{display:flex;align-items:end;justify-content:space-between;gap:2rem}.manuscript-brand{font-family:var(--font-heading);font-size:clamp(1.65rem,4vw,2.8rem)}.manuscript-search{width:min(26rem,45vw)}.manuscript-chapters{display:flex;gap:1.5rem;max-width:var(--content-max);margin:auto;padding:.8rem 1.25rem;overflow-x:auto;border-bottom:1px solid var(--line);white-space:nowrap;scrollbar-width:thin}.manuscript-chapters a{padding:.35rem 0;border-bottom:2px solid transparent}.manuscript-chapters .active{border-color:var(--accent)}.manuscript-page{display:grid;grid-template-columns:minmax(150px,220px) minmax(0,760px);gap:clamp(2rem,6vw,6rem);max-width:1120px;margin:auto;padding:clamp(2rem,7vw,6rem) 1.25rem}.manuscript-margin{position:sticky;top:1.5rem;align-self:start}.manuscript-paper{padding:clamp(1.5rem,5vw,4rem);border:1px solid var(--line);border-radius:calc(var(--radius)*1.5);background:var(--surface);box-shadow:0 24px 70px color-mix(in oklab,var(--fg) 8%,transparent)}.manuscript-paper .article-header{padding-top:0}.manuscript-paper .prose{font-size:1.03em}.manuscript-paper .prose>p:first-of-type{font-size:1.12em}
/* Signal: a dense command surface with independent rail, reader, and index. */
.signal-commandbar{position:sticky;z-index:20;top:0;display:grid;grid-template-columns:190px minmax(12rem,620px) auto;align-items:center;gap:1.25rem;min-height:56px;padding:.5rem 1rem;border-bottom:1px solid var(--line);background:var(--surface)}.signal-commandbar .search{min-height:36px;border-radius:4px}.signal-state{justify-self:end;color:var(--muted);font:12px/1.2 var(--font-code)}.signal-workspace{display:grid;grid-template-columns:210px minmax(0,1fr) 210px;min-height:calc(100vh - 56px)}.signal-rail{position:sticky;top:56px;height:calc(100vh - 56px);overflow:auto;padding:1rem;border-inline-end:1px solid var(--line);background:var(--muted-surface)}.signal-rail .nav{display:grid;gap:.1rem}.signal-rail .nav a{padding:.34rem .5rem;border-radius:4px;font:13px/1.45 var(--font-code)}.signal-rail .nav a:hover,.signal-rail .nav .active{background:var(--surface)}.signal-content{min-width:0;padding:0 clamp(1.25rem,5vw,5rem) 5rem}.signal-content .article-header{display:grid;gap:.55rem;border-bottom:1px solid var(--line)}.signal-content .article-header h1{font-size:clamp(1.8rem,4vw,2.8rem)}.signal-content .prose{max-width:920px}.signal-index{position:sticky;top:56px;height:calc(100vh - 56px);overflow:auto;padding:1.5rem 1rem;border-inline-start:1px solid var(--line)}
body[data-theme-code="vivid"] pre{box-shadow:inset 0 2px var(--accent)}body[data-theme-callouts="outline"] blockquote{background:transparent}body[data-theme-callouts="solid"] blockquote{background:var(--info);color:var(--accent-fg)}
@media(max-width:1050px){.harbor-shell{grid-template-columns:var(--sidebar-width) minmax(0,1fr)}.harbor-toc{visibility:hidden;position:absolute}.signal-workspace{grid-template-columns:190px minmax(0,1fr)}.signal-index{visibility:hidden;position:absolute}}
@media(max-width:760px){html{scroll-padding-top:4rem}.pager{flex-direction:column}.pager a{max-width:none}.harbor-topbar{grid-template-columns:1fr auto;gap:.75rem;min-height:60px;padding:.55rem 1rem}.harbor-topbar .search-wrap{grid-column:1/-1;grid-row:2}.harbor-shell{display:block;padding:0 1rem}.harbor-library{position:static;height:auto;margin-bottom:1rem;padding:1rem 0;border:0;border-bottom:1px solid var(--line)}[dir="rtl"] .harbor-library{padding:1rem 0}.harbor-library .nav{display:flex;gap:.35rem;overflow-x:auto;white-space:nowrap}.harbor-article{padding-bottom:4rem}.manuscript-masthead{padding:1rem}.manuscript-masthead-row{align-items:start;flex-direction:column;gap:.75rem}.manuscript-search{width:100%}.manuscript-chapters{padding-inline:1rem}.manuscript-page{display:block;padding:1.5rem 1rem}.manuscript-margin{position:static;margin-bottom:1.5rem}.manuscript-paper{padding:1.25rem;border-inline:0;border-radius:0;box-shadow:none}.signal-commandbar{grid-template-columns:1fr auto;min-height:52px}.signal-commandbar .search-wrap{grid-column:1/-1;grid-row:2}.signal-workspace{display:block}.signal-rail{position:static;height:auto;padding:.65rem 1rem;border:0;border-bottom:1px solid var(--line)}.signal-rail .nav{display:flex;overflow-x:auto;white-space:nowrap}.signal-content{padding:0 1rem 4rem}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`;
};

const languageFor = (snapshot: SiteSnapshot, page: SnapshotPage): SnapshotLanguage =>
  snapshot.project.languages.find((language) => language.code === page.languageCode) ?? defaultLanguage(snapshot.project);

const exportProjectConfigSchema = z
  .object({
    visibility: z.enum(['public', 'private']).optional(),
    seo: z
      .object({
        metaTitle: z.string().optional(),
        metaDescription: z.string().optional(),
        socialImage: z.string().optional(),
        allowIndex: z.boolean().optional(),
      })
      .loose()
      .optional(),
    search: z.object({ placeholder: z.string().optional() }).loose().optional(),
  })
  .loose();

const exportConfigOf = (snapshot: SiteSnapshot) => {
  const parsed = exportProjectConfigSchema.safeParse(snapshot.project.config ?? {});
  return parsed.success ? parsed.data : {};
};

const visibleVariantPages = (snapshot: SiteSnapshot, page: SnapshotPage): SnapshotPage[] =>
  snapshot.pages
    .filter(
      (candidate) =>
        candidate.kind === 'PAGE' && !candidate.hidden && candidate.versionId === page.versionId && candidate.languageCode === page.languageCode,
    )
    .sort((a, b) => a.position - b.position);

const navHtml = (snapshot: SiteSnapshot, page: SnapshotPage): string => {
  const current = outputPath(snapshot, page);
  return visibleVariantPages(snapshot, page)
    .map((candidate) => {
      const href = path.posix.relative(path.posix.dirname(current), outputPath(snapshot, candidate)) || './';
      return `<a${candidate.id === page.id ? ' class="active" aria-current="page"' : ''} href="${escapeHtml(href)}">${escapeHtml(candidate.title)}</a>`;
    })
    .join('');
};

const searchHtml = (snapshot: SiteSnapshot, page: SnapshotPage): string => {
  const language = languageFor(snapshot, page);
  const placeholder = language.config?.search?.placeholder?.trim() || exportConfigOf(snapshot).search?.placeholder?.trim() || '';
  const accessibleName = placeholder || language.config?.name?.trim() || snapshot.project.name;
  return `<div class="search-wrap"><input class="search" type="search" autocomplete="off" aria-label="${escapeHtml(accessibleName)}"${placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : ''} data-static-search><output class="search-status" aria-live="polite" data-static-search-status></output></div>`;
};

const proseHtml = (snapshot: SiteSnapshot, page: SnapshotPage, assets: ExportAsset[]): string => {
  const headings = extractHeadings(page.content);
  let headingIndex = 0;
  return renderPageMarkdown(snapshot, page, assets)
    .replace(/<h([1-4])>/g, (match) => {
      const heading = headings[headingIndex];
      headingIndex += 1;
      return heading ? `<h${heading.depth} id="${escapeHtml(heading.id)}">` : match;
    })
    .replace(/<pre>/g, '<pre tabindex="0">');
};

const tocHtml = (page: SnapshotPage): string => {
  if (page.config?.hideToc) return '';
  const links = extractHeadings(page.content)
    .filter((heading) => heading.depth === 2 || heading.depth === 3)
    .map((heading) => `<li class="depth-${heading.depth}"><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a></li>`)
    .join('');
  return links ? `<nav class="toc" aria-label="${escapeHtml(page.title)}"><ol>${links}</ol></nav>` : '';
};

const pagerHtml = (snapshot: SiteSnapshot, page: SnapshotPage): string => {
  const pages = visibleVariantPages(snapshot, page);
  const index = pages.findIndex((candidate) => candidate.id === page.id);
  const current = outputPath(snapshot, page);
  const link = (candidate: SnapshotPage | undefined, rel: 'prev' | 'next') => {
    if (!candidate) return '<span></span>';
    const href = path.posix.relative(path.posix.dirname(current), outputPath(snapshot, candidate)) || './';
    return `<a rel="${rel}" href="${escapeHtml(href)}">${escapeHtml(candidate.title)}</a>`;
  };
  return `<nav class="pager" aria-label="${escapeHtml(page.title)}">${link(pages[index - 1], 'prev')}${link(pages[index + 1], 'next')}</nav>`;
};

/** Static archives are origin-neutral by contract. Root-relative discovery URLs
 * resolve to the eventual host without baking a Nibleaf/custom-domain origin
 * into a portable export. Hosts that require absolute sitemap loc values can
 * rebase the leading slash while preserving the generated route inventory. */
const pageArchiveHref = (snapshot: SiteSnapshot, page: SnapshotPage): string => `/${outputPath(snapshot, page)}`;
const pageArchiveMarkdownHref = (snapshot: SiteSnapshot, page: SnapshotPage): string => `/${outputMarkdownPath(snapshot, page)}`;

const variantHomeHref = (snapshot: SiteSnapshot, page: SnapshotPage): string => {
  const first = visibleVariantPages(snapshot, page)[0] ?? page;
  return path.posix.relative(path.posix.dirname(outputPath(snapshot, page)), outputPath(snapshot, first)) || './';
};

const pageIndexable = (snapshot: SiteSnapshot, page: SnapshotPage): boolean => {
  const config = exportConfigOf(snapshot);
  const language = languageFor(snapshot, page);
  return (
    config.visibility !== 'private' &&
    config.seo?.allowIndex !== false &&
    language.enabled !== false &&
    language.config?.seo?.allowIndex !== false &&
    !page.hidden &&
    page.config?.seo?.noindex !== true
  );
};

const seoHead = (snapshot: SiteSnapshot, page: SnapshotPage): string => {
  const config = exportConfigOf(snapshot);
  const language = languageFor(snapshot, page);
  const siteName = language.config?.seo?.metaTitle?.trim() || config.seo?.metaTitle?.trim() || language.config?.name?.trim() || snapshot.project.name;
  const title = page.config?.seo?.metaTitle?.trim() || `${page.title} – ${siteName}`;
  const description =
    page.config?.seo?.metaDescription?.trim() ||
    pageDescription(page) ||
    language.config?.seo?.metaDescription?.trim() ||
    config.seo?.metaDescription?.trim() ||
    language.config?.description?.trim() ||
    snapshot.project.description?.trim() ||
    '';
  const externalCanonical = page.config?.seo?.canonicalUrl?.trim();
  const canonical = externalCanonical || pageArchiveHref(snapshot, page);
  const image = page.config?.seo?.ogImage?.trim() || language.config?.seo?.socialImage?.trim() || config.seo?.socialImage?.trim();
  const robots = pageIndexable(snapshot, page) ? 'index,follow' : 'noindex,nofollow';
  const translated = publicLanguages(snapshot.project.languages)
    .map((candidateLanguage) => {
      const alternate = snapshot.pages.find(
        (candidate) =>
          candidate.kind === 'PAGE' &&
          candidate.versionId === page.versionId &&
          candidate.languageCode === candidateLanguage.code &&
          !candidate.hidden &&
          isPageTranslation(page, candidate) &&
          pageIndexable(snapshot, candidate) &&
          !candidate.config?.seo?.canonicalUrl?.trim(),
      );
      return alternate ? { language: candidateLanguage, page: alternate } : null;
    })
    .filter((alternate): alternate is { language: SnapshotLanguage; page: SnapshotPage } => alternate !== null);
  const defaultCode = defaultLanguage(snapshot.project).code;
  const alternateLinks =
    pageIndexable(snapshot, page) && !externalCanonical && translated.length > 1
      ? translated
          .map(
            ({ language: candidateLanguage, page: candidate }) =>
              `<link rel="alternate" hreflang="${escapeHtml(candidateLanguage.code)}" href="${escapeHtml(pageArchiveHref(snapshot, candidate))}">`,
          )
          .concat(
            translated
              .filter(({ language: candidateLanguage }) => candidateLanguage.code === defaultCode)
              .map(({ page: candidate }) => `<link rel="alternate" hreflang="x-default" href="${escapeHtml(pageArchiveHref(snapshot, candidate))}">`),
          )
          .join('')
      : '';
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TechArticle',
        headline: title,
        description,
        inLanguage: page.languageCode,
        datePublished: page.createdAt ?? page.updatedAt,
        dateModified: page.updatedAt,
        mainEntityOfPage: canonical,
        publisher: { '@type': 'Organization', name: siteName },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: siteName, item: '/' },
          { '@type': 'ListItem', position: 2, name: page.title, item: canonical },
        ],
      },
    ],
  };
  const jsonLd = JSON.stringify(structuredData).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  const variantDirectory = `${safeSegment(versionFor(snapshot, page)?.slug ?? 'main')}/${safeSegment(page.languageCode)}`;
  const markdownDiscovery =
    pageIndexable(snapshot, page) && !externalCanonical
      ? `<link rel="alternate" type="text/markdown" href="${escapeHtml(pageArchiveMarkdownHref(snapshot, page))}"><link rel="describedby" href="/${variantDirectory}/llms.txt">`
      : '';
  return `<meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="${robots}"><meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:site_name" content="${escapeHtml(siteName)}"><meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:locale" content="${escapeHtml(page.languageCode.replace('-', '_'))}"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}">${image ? `<meta property="og:image" content="${escapeHtml(image)}"><meta name="twitter:image" content="${escapeHtml(image)}">` : ''}<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}"><link rel="canonical" href="${escapeHtml(canonical)}"><link rel="sitemap" type="application/xml" href="/sitemap.xml"><link rel="alternate" type="text/plain" href="/${variantDirectory}/llms.txt" title="llms.txt"><link rel="alternate" type="text/plain" href="/${variantDirectory}/llms-full.txt" title="llms-full.txt">${markdownDiscovery}${alternateLinks}<script type="application/ld+json">${jsonLd}</script><title>${escapeHtml(title)}</title>`;
};

const articleHtml = (snapshot: SiteSnapshot, page: SnapshotPage, assets: ExportAsset[]): string =>
  `<header class="article-header"><div class="meta"><time datetime="${escapeHtml(page.updatedAt)}">${escapeHtml(page.updatedAt.slice(0, 10))}</time></div><h1>${escapeHtml(page.title)}</h1>${page.description ? `<p class="article-description">${escapeHtml(page.description)}</p>` : ''}</header><div class="prose">${proseHtml(snapshot, page, assets)}</div>${pagerHtml(snapshot, page)}`;

const harborDocumentBody = (snapshot: SiteSnapshot, page: SnapshotPage, assets: ExportAsset[]): string =>
  `<header class="harbor-topbar"><a class="brand" href="${escapeHtml(variantHomeHref(snapshot, page))}">${escapeHtml(snapshot.project.name)}</a>${searchHtml(snapshot, page)}<span class="harbor-edition meta">${escapeHtml(versionFor(snapshot, page)?.name ?? '')} · ${escapeHtml(languageFor(snapshot, page).label)}</span></header><div class="harbor-shell"><aside class="harbor-library"><nav class="nav" aria-label="${escapeHtml(languageFor(snapshot, page).label)}" data-static-nav>${navHtml(snapshot, page)}</nav></aside><main class="article harbor-article" id="content"><article>${articleHtml(snapshot, page, assets)}</article></main><aside class="harbor-toc">${tocHtml(page)}</aside></div>`;

const manuscriptDocumentBody = (snapshot: SiteSnapshot, page: SnapshotPage, assets: ExportAsset[]): string =>
  `<header class="manuscript-masthead"><div class="manuscript-masthead-row"><a class="brand manuscript-brand" href="${escapeHtml(variantHomeHref(snapshot, page))}">${escapeHtml(snapshot.project.name)}</a><div class="manuscript-search">${searchHtml(snapshot, page)}</div></div></header><nav class="nav manuscript-chapters" aria-label="${escapeHtml(languageFor(snapshot, page).label)}" data-static-nav>${navHtml(snapshot, page)}</nav><div class="manuscript-page"><aside class="manuscript-margin"><div class="meta">${escapeHtml(versionFor(snapshot, page)?.name ?? '')} · ${escapeHtml(languageFor(snapshot, page).label)}</div>${tocHtml(page)}</aside><main class="article manuscript-paper" id="content"><article>${articleHtml(snapshot, page, assets)}</article></main></div>`;

const signalDocumentBody = (snapshot: SiteSnapshot, page: SnapshotPage, assets: ExportAsset[]): string =>
  `<header class="signal-commandbar"><a class="brand" href="${escapeHtml(variantHomeHref(snapshot, page))}">${escapeHtml(snapshot.project.name)}</a>${searchHtml(snapshot, page)}<span class="signal-state">${escapeHtml(versionFor(snapshot, page)?.slug ?? '')}/${escapeHtml(page.languageCode)}</span></header><div class="signal-workspace"><aside class="signal-rail"><nav class="nav" aria-label="${escapeHtml(languageFor(snapshot, page).label)}" data-static-nav>${navHtml(snapshot, page)}</nav></aside><main class="article signal-content" id="content"><article>${articleHtml(snapshot, page, assets)}</article></main><aside class="signal-index">${tocHtml(page)}</aside></div>`;

const pageDocument = (snapshot: SiteSnapshot, page: SnapshotPage, assets: ExportAsset[]): string => {
  const direction = languageFor(snapshot, page).direction;
  const current = outputPath(snapshot, page);
  const themeCss = path.posix.relative(path.posix.dirname(current), 'theme/theme.css');
  const themeJs = path.posix.relative(path.posix.dirname(current), 'theme/theme.js');
  const theme = resolveTheme(themeConfigOf(snapshot));
  const body =
    theme.id === 'manuscript'
      ? manuscriptDocumentBody(snapshot, page, assets)
      : theme.id === 'signal'
        ? signalDocumentBody(snapshot, page, assets)
        : harborDocumentBody(snapshot, page, assets);
  return `<!doctype html><html lang="${escapeHtml(page.languageCode)}" dir="${direction.toLowerCase()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="Nibleaf static export">${seoHead(snapshot, page)}<link rel="stylesheet" href="${escapeHtml(themeCss)}"></head><body data-theme-id="${escapeHtml(theme.id)}" data-theme-shell="${escapeHtml(theme.layout.shell)}" data-theme-sidebar="${escapeHtml(theme.layout.sidebar)}" data-theme-navigation="${escapeHtml(theme.layout.navigation)}" data-theme-code="${escapeHtml(theme.components.codeBlocks)}" data-theme-callouts="${escapeHtml(theme.components.callouts)}" data-version-id="${escapeHtml(page.versionId)}" data-language-code="${escapeHtml(page.languageCode)}">${body}<script src="${escapeHtml(themeJs)}"></script></body></html>`;
};

const themeJs = (searchEntries: Array<{ title: string; path: string; text: string; versionId: string; languageCode: string }>): string =>
  `(()=>{const entries=${JSON.stringify(searchEntries).replaceAll('<', '\\u003c')};const input=document.querySelector('[data-static-search]');const nav=document.querySelector('[data-static-nav]');const status=document.querySelector('[data-static-search-status]');const script=document.currentScript;if(!input||!nav||!script)return;const root=new URL('../',script.src);const original=Array.from(nav.childNodes).map(node=>node.cloneNode(true));const restore=()=>nav.replaceChildren(...original.map(node=>node.cloneNode(true)));input.addEventListener('input',()=>{const q=input.value.trim().toLocaleLowerCase();if(!q){restore();if(status)status.textContent='';return}const matches=entries.filter(x=>x.versionId===document.body.dataset.versionId&&x.languageCode===document.body.dataset.languageCode&&(x.title+' '+x.text).toLocaleLowerCase().includes(q)).slice(0,30);nav.replaceChildren(...matches.map(x=>{const link=document.createElement('a');link.href=new URL(x.path,root).href;link.textContent=x.title;return link}));if(status)status.textContent=String(matches.length)})})();`;

const plainText = (markdown: string): string =>
  markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);

const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();
const machinePageDescription = (page: SnapshotPage): string => oneLine(pageDescription(page));

const machineIndexablePages = (snapshot: SiteSnapshot): SnapshotPage[] => {
  const config = exportConfigOf(snapshot);
  if (config.visibility === 'private' || config.seo?.allowIndex === false) return [];
  const servedLanguages = new Set(publicLanguages(snapshot.project.languages).map((language) => language.code));
  return snapshot.pages.filter(
    (page) =>
      page.kind === 'PAGE' && servedLanguages.has(page.languageCode) && pageIndexable(snapshot, page) && !page.config?.seo?.canonicalUrl?.trim(),
  );
};

const llmsHeader = (snapshot: SiteSnapshot): string[] => {
  const lines = [`# ${oneLine(snapshot.project.name)}`];
  if (snapshot.project.description?.trim()) lines.push('', `> ${oneLine(snapshot.project.description)}`);
  return lines;
};

const llmsTxt = (snapshot: SiteSnapshot, pages: SnapshotPage[], fromDirectory = ''): string => {
  const lines = llmsHeader(snapshot);
  const variants = snapshot.project.versions.flatMap((version) =>
    publicLanguages(snapshot.project.languages).map((language) => ({ version, language })),
  );
  for (const { version, language } of variants) {
    const matching = pages
      .filter((page) => page.versionId === version.id && page.languageCode === language.code)
      .sort((a, b) => a.position - b.position);
    if (matching.length === 0) continue;
    lines.push('', `## ${oneLine(version.name)} · ${oneLine(language.label)}`, '');
    for (const page of matching) {
      const href = path.posix.relative(fromDirectory || '.', outputMarkdownPath(snapshot, page)) || './';
      const description = machinePageDescription(page);
      lines.push(`- [${oneLine(page.title)}](${href})${description ? `: ${description}` : ''}`);
    }
  }
  return `${lines.join('\n')}\n`;
};

const llmsFullTxt = (snapshot: SiteSnapshot, pages: SnapshotPage[], fromDirectory = ''): string => {
  const sections = pages.map((page) => {
    const href = path.posix.relative(fromDirectory || '.', outputMarkdownPath(snapshot, page)) || './';
    const header = [`# ${oneLine(page.title)}`, '', `Source: ${href}`];
    if (page.description?.trim()) header.push('', `> ${oneLine(page.description)}`);
    return `${header.join('\n')}\n\n${normalizePublicMarkdownContent(page.content)}\n`;
  });
  return [...llmsHeader(snapshot), '', sections.join('\n---\n\n')].join('\n');
};

const escapeXml = (value: string): string =>
  value.replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char] ?? char);

const validTimestamp = (value: string, fallback: string): string => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(fallback).toISOString() : parsed.toISOString();
};

const sitemapXml = (snapshot: SiteSnapshot, pages: SnapshotPage[]): string => {
  const urls = pages.map((page) => {
    const alternates = pages
      .filter((candidate) => candidate.versionId === page.versionId && candidate.id !== page.id && isPageTranslation(page, candidate))
      .map(
        (candidate) =>
          `<xhtml:link rel="alternate" hreflang="${escapeXml(candidate.languageCode)}" href="${escapeXml(pageArchiveHref(snapshot, candidate))}"/>`,
      )
      .join('');
    return `  <url><loc>${escapeXml(pageArchiveHref(snapshot, page))}</loc><lastmod>${escapeXml(validTimestamp(page.updatedAt, snapshot.generatedAt))}</lastmod>${alternates}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
};

const robotsTxt = (snapshot: SiteSnapshot): string => {
  const config = exportConfigOf(snapshot);
  if (config.visibility === 'private' || config.seo?.allowIndex === false) return 'User-agent: *\nDisallow: /\n';
  return 'User-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: *\nAllow: /\nSitemap: /sitemap.xml\n';
};

export const renderStaticHtml = (snapshot: SiteSnapshot, assets: ExportAsset[]): RenderedArtifact => {
  const files: Record<string, Uint8Array> = {
    'theme/theme.css': strToU8(exportThemeCss(snapshot)),
  };
  // Static HTML is a publishable reader artifact, not a source backup. Match
  // the live reader and PDF export by omitting hidden pages entirely, including
  // from the bundled client-side search index. Markdown ZIP remains the format
  // that intentionally preserves hidden source with `hidden: true` frontmatter.
  const servedLanguages = new Set(publicLanguages(snapshot.project.languages).map((language) => language.code));
  const pages = snapshot.pages.filter((page) => page.kind === 'PAGE' && !page.hidden && servedLanguages.has(page.languageCode));
  for (const page of pages) files[outputPath(snapshot, page)] = strToU8(pageDocument(snapshot, page, assets));
  for (const asset of assets) files[assetName(asset)] = asset.bytes;
  const first = pages.find((page) => !page.hidden) ?? pages[0];
  files['index.html'] = strToU8(
    first
      ? `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escapeHtml(outputPath(snapshot, first))}"><a href="${escapeHtml(outputPath(snapshot, first))}">${escapeHtml(snapshot.project.name)}</a>`
      : `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(snapshot.project.name)}</title>`,
  );
  const searchEntries = pages.map((page) => ({
    title: page.title,
    path: outputPath(snapshot, page),
    text: plainText(normalizePublicMarkdownContent(page.content)),
    versionId: page.versionId,
    languageCode: page.languageCode,
  }));
  files['theme/theme.js'] = strToU8(themeJs(searchEntries));
  const indexablePages = machineIndexablePages(snapshot);
  for (const page of indexablePages) {
    const description = page.description?.trim();
    const parts = [`# ${oneLine(page.title)}`, ...(description ? [`> ${oneLine(description)}`] : []), normalizePublicMarkdownContent(page.content)];
    files[outputMarkdownPath(snapshot, page)] = strToU8(`${parts.filter(Boolean).join('\n\n')}\n`);
  }
  const machineFilesEnabled = exportConfigOf(snapshot).visibility !== 'private' && exportConfigOf(snapshot).seo?.allowIndex !== false;
  files['robots.txt'] = strToU8(robotsTxt(snapshot));
  files['sitemap.xml'] = strToU8(sitemapXml(snapshot, indexablePages));
  files['llms.txt'] = strToU8(machineFilesEnabled ? llmsTxt(snapshot, indexablePages) : '');
  files['llms-full.txt'] = strToU8(machineFilesEnabled ? llmsFullTxt(snapshot, indexablePages) : '');
  for (const version of snapshot.project.versions) {
    for (const language of publicLanguages(snapshot.project.languages)) {
      const directory = `${safeSegment(version.slug)}/${safeSegment(language.code)}`;
      const variantPages = indexablePages.filter((page) => page.versionId === version.id && page.languageCode === language.code);
      files[`${directory}/llms.txt`] = strToU8(machineFilesEnabled ? llmsTxt(snapshot, variantPages, directory) : '');
      files[`${directory}/llms-full.txt`] = strToU8(machineFilesEnabled ? llmsFullTxt(snapshot, variantPages, directory) : '');
    }
  }
  const theme = resolveTheme(themeConfigOf(snapshot));
  files['export.json'] = strToU8(
    `${JSON.stringify({ generator: 'nibleaf', generatedAt: snapshot.generatedAt, project: { id: snapshot.project.id, name: snapshot.project.name, slug: snapshot.project.slug }, theme: { id: theme.id, schemaVersion: THEME_SCHEMA_VERSION }, pages: pages.length }, null, 2)}\n`,
  );
  return { bytes: zipSync(files, { level: 6 }), contentType: 'application/zip', extension: 'zip' };
};

const frontMatter = (page: SnapshotPage): string => {
  const values = ['---', `title: ${JSON.stringify(page.title)}`];
  if (page.description) values.push(`description: ${JSON.stringify(page.description)}`);
  if (page.icon) values.push(`icon: ${JSON.stringify(page.icon)}`);
  if (page.hidden) values.push('hidden: true');
  values.push('---', '');
  return values.join('\n');
};

export const renderMarkdownZip = (snapshot: SiteSnapshot, assets: ExportAsset[]): RenderedArtifact => {
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const page of snapshot.pages) {
    if (page.kind !== 'PAGE') continue;
    const version = safeSegment(versionFor(snapshot, page)?.slug ?? 'main');
    let name = `${version}/${safeSegment(page.languageCode)}/${safePath(page.path)}.md`;
    if (used.has(name)) name = name.replace(/\.md$/, `-${safeSegment(page.id)}.md`);
    used.add(name);
    files[name] = strToU8(`${frontMatter(page)}\n${page.content}`);
  }
  for (const asset of assets) files[assetName(asset)] = asset.bytes;
  files['project.json'] = encoder.encode(
    `${JSON.stringify({ name: snapshot.project.name, slug: snapshot.project.slug, description: snapshot.project.description, languages: snapshot.project.languages, versions: snapshot.project.versions, themeTemplate: themeTemplateFromConfig(themeConfigOf(snapshot) as Record<string, unknown>), pagesCount: snapshot.pages.filter((page) => page.kind === 'PAGE').length, publishedAt: snapshot.generatedAt, generator: 'nibleaf' }, null, 2)}\n`,
  );
  return { bytes: zipSync(files, { level: 6 }), contentType: 'application/zip', extension: 'zip' };
};

export const renderPdfHtml = (snapshot: SiteSnapshot, assets: ExportAsset[]): string => {
  const assetData = new Map(assets.map((asset) => [asset.url, `data:${asset.contentType};base64,${Buffer.from(asset.bytes).toString('base64')}`]));
  const pages = snapshot.pages.filter((page) => page.kind === 'PAGE' && !page.hidden);
  const content = pages
    .map((page) => {
      const direction = snapshot.project.languages.find((language) => language.code === page.languageCode)?.direction ?? 'LTR';
      let html = String(marked.parse(portablePublicMdxMarkdown(page.content)));
      html = html
        .replace(/(<img\b[^>]*\bsrc=")([^"]*)(")/gi, (_all, before, url, after) => `${before}${assetData.get(url) ?? '#'}${after}`)
        .replace(/(<a\b[^>]*\bhref=")([^"]*)(")/gi, (_all, before, href, after) => {
          const target = resolvePageTarget(snapshot, page, href);
          return `${before}${target ? `#page-${escapeHtml(target.id)}` : escapeHtml(href)}${after}`;
        });
      return `<article id="page-${escapeHtml(page.id)}" dir="${direction.toLowerCase()}"><h1>${escapeHtml(page.title)}</h1>${html}</article>`;
    })
    .join('');
  const theme = resolveTheme(themeConfigOf(snapshot));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="author" content="Nibleaf"><meta name="generator" content="Nibleaf export"><title>${escapeHtml(snapshot.project.name)}</title><style>${exportThemeCss(snapshot, true)}body{max-width:none;padding:0 24px}article{break-before:page;page-break-before:always}article:first-child{break-before:auto;page-break-before:auto}h1,h2,h3{break-after:avoid;page-break-after:avoid}pre,table,img,blockquote{break-inside:avoid;page-break-inside:avoid}table{display:table;width:100%;font-size:10pt}a{text-decoration:none}@page{size:A4;margin:18mm 16mm}@media print{body{font-size:10.5pt}pre{white-space:pre-wrap;overflow-wrap:anywhere}thead{display:table-header-group}}</style></head><body data-theme-id="${escapeHtml(theme.id)}"><header><h1>${escapeHtml(snapshot.project.name)}</h1><p>${escapeHtml(snapshot.project.description ?? '')}</p><p class="meta"><time datetime="${escapeHtml(snapshot.generatedAt)}">${escapeHtml(snapshot.generatedAt)}</time></p></header>${content}</body></html>`;
};
