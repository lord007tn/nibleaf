import path from 'node:path';
import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import {
  resolveTheme,
  safeThemeFontFamily,
  safeThemeHex,
  THEME_SCHEMA_VERSION,
  type ThemeColorTokens,
  type ThemeOwnedProjectConfig,
  themeTemplateFromConfig,
} from '@nibleaf/shared/themes';
import { strToU8, zipSync } from 'fflate';
import { Marked } from 'marked';

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
  const html = String(marked.parse(page.content));
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

const themeConfigOf = (snapshot: SiteSnapshot): ThemeOwnedProjectConfig => (snapshot.project.config ?? {}) as ThemeOwnedProjectConfig;

const safeCssNumber = (value: unknown, fallback: number, minimum: number, maximum: number): string => {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
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
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--fg);font:var(--font-size)/var(--leading) var(--font-body)}:is(h1,h2,h3,h4,h5,h6){font-family:var(--font-heading)}main :is(p,pre,table,blockquote){margin-block:var(--flow)}a{color:var(--accent)}a:focus-visible,input:focus-visible{outline:3px solid var(--focus);outline-offset:2px}.layout{display:grid;grid-template-columns:var(--sidebar-width) minmax(0,850px);gap:48px;max-width:var(--content-max);margin:auto;padding:32px}.sidebar{position:sticky;top:0;height:100vh;overflow:auto;border-inline-end:1px solid var(--line);padding-inline-end:24px}.brand{font-weight:750;font-size:1.1rem}.meta{color:var(--muted);font-size:.86rem}.nav a{display:block;padding:5px 0;text-decoration:none}.nav .active{font-weight:700}.search{width:100%;margin:18px 0;padding:9px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);color:var(--fg)}main{min-width:0;padding-bottom:100px}img{max-width:100%;height:auto}pre{overflow:auto;padding:16px;border-radius:var(--radius);background:var(--code);color:var(--code-fg);direction:ltr;text-align:left}code{font-family:var(--font-code)}table{display:block;overflow:auto;border-collapse:collapse}th,td{border:1px solid var(--line);padding:8px 12px}blockquote{border-inline-start:4px solid var(--info);margin-inline:0;padding:12px 16px;color:var(--muted);background:color-mix(in oklab,var(--info) 9%,transparent)}body[data-theme-sidebar="soft"] .sidebar{border:0;background:var(--muted-surface);padding:20px}body[data-theme-sidebar="rail"] .sidebar{border-inline-end-width:2px}body[data-theme-navigation="compact"] .nav a{padding:2px 0;font-size:.86em}body[data-theme-shell="editorial"] .layout{display:block}body[data-theme-shell="editorial"] .sidebar{position:static;width:100%;height:auto;border-inline-end:0;border-bottom:1px solid var(--line);padding:20px 0}body[data-theme-shell="editorial"] .nav{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px 24px}body[data-theme-shell="editorial"] main{max-width:760px;margin:auto;padding-top:48px}body[data-theme-shell="console"] .layout{grid-template-columns:210px minmax(0,1fr);gap:24px}body[data-theme-shell="console"] .sidebar{height:calc(100vh - 32px);top:16px;padding:16px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}body[data-theme-code="vivid"] pre{box-shadow:inset 0 2px var(--accent)}body[data-theme-callouts="outline"] blockquote{background:transparent}body[data-theme-callouts="solid"] blockquote{background:var(--info);color:var(--accent-fg)}@media(max-width:760px){.layout{display:block;padding:20px}.sidebar{position:static;height:auto;border:0;border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:28px}body[data-theme-shell="editorial"] .nav{grid-template-columns:1fr 1fr}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`;
};

const navHtml = (snapshot: SiteSnapshot, page: SnapshotPage): string => {
  const current = outputPath(snapshot, page);
  return snapshot.pages
    .filter(
      (candidate) =>
        candidate.kind === 'PAGE' && !candidate.hidden && candidate.versionId === page.versionId && candidate.languageCode === page.languageCode,
    )
    .sort((a, b) => a.position - b.position)
    .map((candidate) => {
      const href = path.posix.relative(path.posix.dirname(current), outputPath(snapshot, candidate)) || './';
      return `<a${candidate.id === page.id ? ' class="active" aria-current="page"' : ''} href="${escapeHtml(href)}">${escapeHtml(candidate.title)}</a>`;
    })
    .join('');
};

const pageDocument = (snapshot: SiteSnapshot, page: SnapshotPage, assets: ExportAsset[]): string => {
  const direction = snapshot.project.languages.find((language) => language.code === page.languageCode)?.direction ?? 'LTR';
  const current = outputPath(snapshot, page);
  const themeCss = path.posix.relative(path.posix.dirname(current), 'theme/theme.css');
  const themeJs = path.posix.relative(path.posix.dirname(current), 'theme/theme.js');
  const theme = resolveTheme(themeConfigOf(snapshot));
  return `<!doctype html><html lang="${escapeHtml(page.languageCode)}" dir="${direction.toLowerCase()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="Nibleaf static export"><meta name="description" content="${escapeHtml(page.description ?? snapshot.project.description ?? '')}"><title>${escapeHtml(page.title)} – ${escapeHtml(snapshot.project.name)}</title><link rel="stylesheet" href="${themeCss}"></head><body data-theme-id="${theme.id}" data-theme-shell="${escapeHtml(theme.layout.shell)}" data-theme-sidebar="${escapeHtml(theme.layout.sidebar)}" data-theme-navigation="${escapeHtml(theme.layout.navigation)}" data-theme-code="${escapeHtml(theme.components.codeBlocks)}" data-theme-callouts="${escapeHtml(theme.components.callouts)}"><div class="layout"><aside class="sidebar"><div class="brand">${escapeHtml(snapshot.project.name)}</div><div class="meta">Published archive · ${escapeHtml(snapshot.generatedAt)}</div><input class="search" type="search" placeholder="Search" data-static-search><div class="nav" data-static-nav>${navHtml(snapshot, page)}</div></aside><main><h1>${escapeHtml(page.title)}</h1>${renderPageMarkdown(snapshot, page, assets)}</main></div><script src="${themeJs}"></script></body></html>`;
};

const themeJs = (searchEntries: Array<{ title: string; path: string; text: string }>): string =>
  `(()=>{const entries=${JSON.stringify(searchEntries).replaceAll('<', '\\u003c')};const input=document.querySelector('[data-static-search]');const nav=document.querySelector('[data-static-nav]');const script=document.currentScript;if(!input||!nav||!script)return;const root=new URL('../',script.src);const original=nav.innerHTML;input.addEventListener('input',()=>{const q=input.value.trim().toLocaleLowerCase();if(!q){nav.innerHTML=original;return}nav.innerHTML=entries.filter(x=>(x.title+' '+x.text).toLocaleLowerCase().includes(q)).slice(0,30).map(x=>'<a href="'+new URL(x.path,root).href+'">'+x.title.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+'</a>').join('')||'<span class="meta">No results</span>'})})();`;

const plainText = (markdown: string): string =>
  markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);

export const renderStaticHtml = (snapshot: SiteSnapshot, assets: ExportAsset[]): RenderedArtifact => {
  const files: Record<string, Uint8Array> = {
    'theme/theme.css': strToU8(exportThemeCss(snapshot)),
  };
  // Static HTML is a publishable reader artifact, not a source backup. Match
  // the live reader and PDF export by omitting hidden pages entirely, including
  // from the bundled client-side search index. Markdown ZIP remains the format
  // that intentionally preserves hidden source with `hidden: true` frontmatter.
  const pages = snapshot.pages.filter((page) => page.kind === 'PAGE' && !page.hidden);
  for (const page of pages) files[outputPath(snapshot, page)] = strToU8(pageDocument(snapshot, page, assets));
  for (const asset of assets) files[assetName(asset)] = asset.bytes;
  const first = pages.find((page) => !page.hidden) ?? pages[0];
  files['index.html'] = strToU8(
    first
      ? `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escapeHtml(outputPath(snapshot, first))}"><a href="${escapeHtml(outputPath(snapshot, first))}">${escapeHtml(snapshot.project.name)}</a>`
      : '<!doctype html><meta charset="utf-8"><title>Empty export</title><p>This published revision has no pages.</p>',
  );
  const searchEntries = pages.map((page) => ({ title: page.title, path: outputPath(snapshot, page), text: plainText(page.content) }));
  files['theme/theme.js'] = strToU8(themeJs(searchEntries));
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
      let html = String(marked.parse(page.content));
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
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="author" content="Nibleaf"><meta name="generator" content="Nibleaf export"><title>${escapeHtml(snapshot.project.name)}</title><style>${exportThemeCss(snapshot, true)}body{max-width:none;padding:0 24px}article{break-before:page;page-break-before:always}article:first-child{break-before:auto;page-break-before:auto}h1,h2,h3{break-after:avoid;page-break-after:avoid}pre,table,img,blockquote{break-inside:avoid;page-break-inside:avoid}table{display:table;width:100%;font-size:10pt}a{text-decoration:none}@page{size:A4;margin:18mm 16mm}@media print{body{font-size:10.5pt}pre{white-space:pre-wrap;overflow-wrap:anywhere}thead{display:table-header-group}}</style></head><body data-theme-id="${theme.id}"><header><h1>${escapeHtml(snapshot.project.name)}</h1><p>${escapeHtml(snapshot.project.description ?? '')}</p><p class="meta">Published ${escapeHtml(snapshot.generatedAt)}</p></header>${content}</body></html>`;
};
