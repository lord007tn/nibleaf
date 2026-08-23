import { createRequire } from 'node:module';
import { slugify } from '@nibleaf/shared';
import type { LexicalHTMLRenderer as LexicalHTMLRendererInstance } from '@tryghost/kg-lexical-html-renderer';
import type { MobiledocHtmlRenderer as MobiledocHtmlRendererInstance } from '@tryghost/kg-mobiledoc-html-renderer';
import TurndownService from 'turndown';
import { strikethrough, tables } from 'turndown-plugin-gfm';
import { ghostMobiledocSchema, importDocumentSchema, nonEmptyImportStringSchema } from '@/validators/importers';
import { stableHash } from './content';

/**
 * Pure mapping logic for the Ghost importer: validate the export document's
 * shape and convert post/page HTML to Markdown. No prisma / `@/…` imports so
 * unit tests run without a database.
 */

/** Ghost media URLs are exported with this placeholder in front of `/content/…`. */
const GHOST_URL_PLACEHOLDER = '__GHOST_URL__';

export class GhostExportError extends Error {
  readonly code = 'import:invalid_document';

  constructor(message: string) {
    super(message);
    this.name = 'GhostExportError';
  }
}

/** Optional Nibleaf metadata added beside the untouched Ghost export by the
 * dashboard. Ghost's JSON does not contain the publication URL, but that URL
 * is required to resolve `__GHOST_URL__/content/images/...` placeholders. */
export const ghostImportSourceUrl = (input: unknown): string | undefined => {
  if (!isDict(input) || !isDict(input.__nibleafImport)) return undefined;
  const raw = str(input.__nibleafImport.ghostUrl);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
};

/** The subset of a Ghost `posts` row the importer consumes. */
export interface GhostContentItem {
  id: string;
  title: string;
  slug: string;
  html: string | null;
  lexical: string | null;
  mobiledoc: string | null;
  plaintext: string | null;
  status: string | null;
  visibility?: string | null;
  featureImage: string | null;
  description: string | null;
  publishedAt: string | null;
  /** Normalized Ghost tag slugs, in the order stored by Ghost. */
  tags: string[];
}

type Dict = Record<string, unknown>;
const isDict = (value: unknown): value is Dict => importDocumentSchema.safeParse(value).success;
const str = (value: unknown) => {
  const parsed = nonEmptyImportStringSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const toItem = (row: Dict, tagsByPostId: ReadonlyMap<string, string[]>): GhostContentItem | null => {
  const title = str(row.title);
  const slug = str(row.slug);
  if (!title && !slug) {
    return null;
  }
  return {
    id: str(row.id) ?? `${slug ?? title}`,
    title: title ?? (slug as string),
    slug: slug ?? '',
    html: str(row.html),
    lexical: str(row.lexical),
    mobiledoc: str(row.mobiledoc),
    plaintext: str(row.plaintext),
    status: str(row.status),
    visibility: str(row.visibility),
    featureImage: str(row.feature_image),
    description: str(row.custom_excerpt) ?? str(row.excerpt),
    publishedAt: str(row.published_at),
    tags: tagsByPostId.get(str(row.id) ?? '') ?? [],
  };
};

const isGhostPage = (row: Dict): boolean => row.type === 'page' || row.page === true || row.page === 1;

/** Published, public items only. Member, paid, and tier-restricted Ghost
 * content must never become public documentation through an import. */
const isPubliclyPublished = (item: GhostContentItem) =>
  (item.status === null || item.status === 'published') && (!item.visibility || item.visibility === 'public');

export interface GhostExportContent {
  posts: GhostContentItem[];
  pages: GhostContentItem[];
  restricted: number;
}

/**
 * Validate + normalize a Ghost JSON export. Accepts the full export shape
 * (`{ db: [{ data: { posts, pages?, … } }] }`) as well as the bare inner
 * document (`{ data: { posts } }`). Throws `GhostExportError` on anything else.
 */
export const parseGhostExport = (input: unknown): GhostExportContent => {
  if (!isDict(input)) {
    throw new GhostExportError('The uploaded file is not a JSON object.');
  }
  const db = Array.isArray(input.db) ? input.db[0] : undefined;
  const data = isDict(db) && isDict(db.data) ? db.data : isDict(input.data) ? input.data : Array.isArray(input.posts) ? input : undefined;
  if (!data) {
    throw new GhostExportError('Not a Ghost export — expected db[0].data (or data) with a posts collection.');
  }
  const rawPosts = Array.isArray(data.posts) ? data.posts : [];
  const rawPages = Array.isArray(data.pages) ? data.pages : [];
  if (rawPosts.length === 0 && rawPages.length === 0) {
    throw new GhostExportError('Not a Ghost export — no posts or pages collection found.');
  }

  const tagById = new Map<string, string>();
  for (const row of Array.isArray(data.tags) ? data.tags : []) {
    if (!isDict(row)) continue;
    const id = str(row.id);
    const slug = str(row.slug) ?? str(row.name);
    if (id && slug) tagById.set(id, slug.trim().toLowerCase());
  }
  const tagsByPostId = new Map<string, string[]>();
  for (const row of Array.isArray(data.posts_tags) ? data.posts_tags : []) {
    if (!isDict(row)) continue;
    const postId = str(row.post_id);
    const tag = tagById.get(str(row.tag_id) ?? '');
    if (!(postId && tag)) continue;
    const current = tagsByPostId.get(postId) ?? [];
    if (!current.includes(tag)) current.push(tag);
    tagsByPostId.set(postId, current);
  }

  const posts: GhostContentItem[] = [];
  const pages: GhostContentItem[] = [];
  let restricted = 0;
  // Ghost stores static pages in the posts table (type: 'page' / legacy page: 1);
  // newer exports may also ship a separate `pages` collection.
  for (const row of rawPosts) {
    if (!isDict(row)) {
      continue;
    }
    const item = toItem(row, tagsByPostId);
    if (item) {
      if (isPubliclyPublished(item)) {
        (isGhostPage(row) ? pages : posts).push(item);
      } else if ((item.status === null || item.status === 'published') && item.visibility && item.visibility !== 'public') {
        restricted++;
      }
    }
  }
  for (const row of rawPages) {
    if (!isDict(row)) {
      continue;
    }
    const item = toItem(row, tagsByPostId);
    if (item) {
      if (isPubliclyPublished(item)) {
        pages.push(item);
      } else if ((item.status === null || item.status === 'published') && item.visibility && item.visibility !== 'public') {
        restricted++;
      }
    }
  }
  return { posts, pages, restricted };
};

export type GhostLanguageResolution = {
  code: string;
  reason: 'tag' | 'ambiguous-tags' | 'default';
};

const primaryLanguage = (code: string): string => code.toLowerCase().split('-')[0] ?? code.toLowerCase();
const hasArabicScript = (value: string): boolean => /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u.test(value);

/** Resolve one Ghost item to a configured project language. Exact language
 * tags win (`en`, `ar`, `pt-br`). A base tag may target one regional locale.
 * When an item accidentally carries multiple language tags, Arabic script is
 * used only to disambiguate between those tagged choices; otherwise the first
 * tag wins deterministically. Untagged content goes to the project default and
 * is reported by the importer so editors can fix the Ghost data and re-import. */
export const resolveGhostLanguage = (
  item: Pick<GhostContentItem, 'tags' | 'title' | 'plaintext' | 'html'>,
  languageCodes: readonly string[],
  defaultCode: string,
): GhostLanguageResolution => {
  const byCode = new Map(languageCodes.map((code) => [code.toLowerCase(), code]));
  const byPrimary = new Map<string, string[]>();
  for (const code of languageCodes) {
    const primary = primaryLanguage(code);
    byPrimary.set(primary, [...(byPrimary.get(primary) ?? []), code]);
  }
  const matches: string[] = [];
  for (const tag of item.tags) {
    const normalized = tag.toLowerCase();
    const exact = byCode.get(normalized);
    const regional = byPrimary.get(normalized);
    const match = exact ?? (regional?.length === 1 ? regional[0] : undefined);
    if (match && !matches.includes(match)) matches.push(match);
  }
  if (matches.length === 1 && matches[0]) return { code: matches[0], reason: 'tag' };
  if (matches.length > 1) {
    const sample = `${item.title}\n${item.plaintext ?? ''}\n${item.html ?? ''}`;
    const arabic = matches.find((code) => primaryLanguage(code) === 'ar');
    const nonArabic = matches.find((code) => primaryLanguage(code) !== 'ar');
    return { code: hasArabicScript(sample) && arabic ? arabic : (nonArabic ?? matches[0] ?? defaultCode), reason: 'ambiguous-tags' };
  }
  return { code: defaultCode, reason: 'default' };
};

export interface GhostSlugResult {
  slug: string;
  /** True when the name had no Latin characters and a hash fallback was used. */
  usedHashFallback: boolean;
}

/** Import slug for a Ghost item: the slugified slug/title when it yields Latin
 *  characters, otherwise a stable per-item hash (`post-a1b2c3d4`) so distinct
 *  non-Latin posts (e.g. Arabic titles) never collapse onto one shared `post`
 *  literal — and re-imports keep landing on the same page. */
export const ghostItemSlug = (item: Pick<GhostContentItem, 'slug' | 'title'>, index: number): GhostSlugResult => {
  const slug = slugify(item.slug || item.title);
  if (slug) {
    return { slug, usedHashFallback: false };
  }
  return { slug: `post-${stableHash(item.slug || item.title || String(index))}`, usedHashFallback: true };
};

/** Chronological order (oldest first) so positions mirror publish history. */
export const byPublishedAt = (a: GhostContentItem, b: GhostContentItem): number => {
  if (!a.publishedAt || !b.publishedAt) {
    return a.publishedAt ? -1 : b.publishedAt ? 1 : 0;
  }
  return a.publishedAt.localeCompare(b.publishedAt);
};

/** Ghost ships a default placeholder post on new publications. It is not
 * documentation and should never displace real imported content. */
export const isGhostPlaceholder = (item: Pick<GhostContentItem, 'title' | 'slug' | 'plaintext'>): boolean => {
  const title = item.title.trim().toLowerCase();
  const slug = item.slug.trim().toLowerCase();
  const content = (item.plaintext ?? '').toLowerCase();
  return (
    title === 'coming soon' &&
    /^coming-soon(?:-\d+)?$/.test(slug) &&
    (content.includes('brand new site') || content.includes('up and running here shortly'))
  );
};

let turndown: TurndownService | null = null;
const getTurndown = (): TurndownService => {
  if (!turndown) {
    turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', hr: '---' });
    // GFM extras: tables + strikethrough (images and fenced code are core rules).
    turndown.use([tables, strikethrough]);
  }
  return turndown;
};

// Both Ghost renderers publish a CommonJS build. Loading that build is
// intentional: Lexical 0.13 exposes its runtime through CommonJS and cannot be
// consumed through Node's synthetic ESM named exports.
const require = createRequire(import.meta.url);
const { LexicalHTMLRenderer } = require('@tryghost/kg-lexical-html-renderer') as {
  LexicalHTMLRenderer: new () => LexicalHTMLRendererInstance;
};
const { MobiledocHtmlRenderer } = require('@tryghost/kg-mobiledoc-html-renderer') as {
  MobiledocHtmlRenderer: new () => MobiledocHtmlRendererInstance;
};
const lexicalRenderer = new LexicalHTMLRenderer();
const mobiledocRenderer = new MobiledocHtmlRenderer();

const storedGhostHtml = async (item: GhostContentItem) => {
  if (item.html) return { html: item.html, usedFallback: false };
  if (item.lexical) {
    try {
      return { html: await lexicalRenderer.render(item.lexical), usedFallback: false };
    } catch {
      // Fall through to the legacy format or plaintext from the same export.
    }
  }
  if (item.mobiledoc) {
    try {
      const document = ghostMobiledocSchema.parse(JSON.parse(item.mobiledoc));
      return { html: mobiledocRenderer.render(document), usedFallback: false };
    } catch {
      // Fall through to plaintext from the same export.
    }
  }
  return { html: item.plaintext ?? '', usedFallback: Boolean(item.lexical || item.mobiledoc) };
};

/** Last-resort conversion: strip tags and collapse whitespace. */
const decodeHtmlEntity = (entity: string): string => {
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
  };
  return entities[entity.toLowerCase()] ?? entity;
};

export const htmlToPlainText = (html: string): string =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/gi, decodeHtmlEntity)
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();

export interface GhostHtmlConversion {
  markdown: string;
  usedFallback: boolean;
  /** True when the export referenced its own site via __GHOST_URL__ placeholders. */
  hadGhostUrls: boolean;
}

/** Convert Ghost HTML to Markdown, falling back to plain text when turndown fails. */
export const convertGhostHtml = (html: string, ghostSourceUrl?: string): GhostHtmlConversion => {
  const hadGhostUrls = html.includes(GHOST_URL_PLACEHOLDER);
  // Resolve placeholders to the source publication so the asset migrator can
  // download them. Legacy/direct API calls without a source URL retain the old
  // site-relative fallback and receive an explicit importer warning.
  const prepared = html
    .replaceAll(GHOST_URL_PLACEHOLDER, ghostSourceUrl ?? '')
    .replace(/(\b(?:src|poster)\s*=\s*["']?)(\/content\/[^"'\s>]+)/gi, (_match, prefix: string, path: string) =>
      ghostSourceUrl ? `${prefix}${new URL(path, ghostSourceUrl).toString()}` : `${prefix}${path}`,
    );
  try {
    return { markdown: getTurndown().turndown(prepared).trim(), usedFallback: false, hadGhostUrls };
  } catch {
    return { markdown: htmlToPlainText(prepared), usedFallback: true, hadGhostUrls };
  }
};

/** Full page body for one Ghost item: optional leading feature image + converted HTML. */
export const ghostItemToMarkdown = async (item: GhostContentItem, ghostSourceUrl?: string) => {
  const source = await storedGhostHtml(item);
  const conversion = source.html
    ? { ...convertGhostHtml(source.html, ghostSourceUrl), usedFallback: source.usedFallback }
    : { markdown: '', usedFallback: source.usedFallback, hadGhostUrls: false };
  if (item.featureImage) {
    const rawImage = item.featureImage.replaceAll(GHOST_URL_PLACEHOLDER, ghostSourceUrl ?? '');
    const image = ghostSourceUrl && rawImage.startsWith('/') ? new URL(rawImage, ghostSourceUrl).toString() : rawImage;
    const alt = item.title.replace(/[[\]\n]/g, ' ').trim();
    const hadGhostUrls = conversion.hadGhostUrls || item.featureImage.includes(GHOST_URL_PLACEHOLDER);
    return { ...conversion, hadGhostUrls, markdown: `![${alt}](${image})\n\n${conversion.markdown}`.trim() };
  }
  return conversion;
};
