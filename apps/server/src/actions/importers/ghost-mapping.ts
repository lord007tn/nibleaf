import { slugify } from '@nibleaf/shared';
import TurndownService from 'turndown';
import { strikethrough, tables } from 'turndown-plugin-gfm';
import { stableHash } from './content';

/**
 * Pure mapping logic for the Ghost importer: validate the export document's
 * shape and convert post/page HTML to Markdown. No prisma / `@/…` imports so
 * unit tests run without a database.
 */

/** Ghost media URLs are exported with this placeholder in front of `/content/…`. */
const GHOST_URL_PLACEHOLDER = '__GHOST_URL__';

export class GhostExportError extends Error {}

/** The subset of a Ghost `posts` row the importer consumes. */
export interface GhostContentItem {
  title: string;
  slug: string;
  html: string | null;
  plaintext: string | null;
  status: string | null;
  featureImage: string | null;
  description: string | null;
  publishedAt: string | null;
}

type Dict = Record<string, unknown>;
const isDict = (value: unknown): value is Dict => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

const toItem = (row: Dict): GhostContentItem | null => {
  const title = str(row.title);
  const slug = str(row.slug);
  if (!title && !slug) {
    return null;
  }
  return {
    title: title ?? (slug as string),
    slug: slug ?? '',
    html: str(row.html),
    plaintext: str(row.plaintext),
    status: str(row.status),
    featureImage: str(row.feature_image),
    description: str(row.custom_excerpt) ?? str(row.excerpt),
    publishedAt: str(row.published_at),
  };
};

const isGhostPage = (row: Dict): boolean => row.type === 'page' || row.page === true || row.page === 1;

/** Published items only — drafts and scheduled posts stay out of the docs site. */
const isPublished = (item: GhostContentItem): boolean => item.status === null || item.status === 'published';

export interface GhostExportContent {
  posts: GhostContentItem[];
  pages: GhostContentItem[];
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

  const posts: GhostContentItem[] = [];
  const pages: GhostContentItem[] = [];
  // Ghost stores static pages in the posts table (type: 'page' / legacy page: 1);
  // newer exports may also ship a separate `pages` collection.
  for (const row of rawPosts) {
    if (!isDict(row)) {
      continue;
    }
    const item = toItem(row);
    if (item && isPublished(item)) {
      (isGhostPage(row) ? pages : posts).push(item);
    }
  }
  for (const row of rawPages) {
    if (!isDict(row)) {
      continue;
    }
    const item = toItem(row);
    if (item && isPublished(item)) {
      pages.push(item);
    }
  }
  return { posts, pages };
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

let turndown: TurndownService | null = null;
const getTurndown = (): TurndownService => {
  if (!turndown) {
    turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', hr: '---' });
    // GFM extras: tables + strikethrough (images and fenced code are core rules).
    turndown.use([tables, strikethrough]);
  }
  return turndown;
};

/** Last-resort conversion: strip tags and collapse whitespace. */
export const htmlToPlainText = (html: string): string =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
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
export const convertGhostHtml = (html: string): GhostHtmlConversion => {
  const hadGhostUrls = html.includes(GHOST_URL_PLACEHOLDER);
  // Make placeholder media URLs site-relative so the Markdown stays valid.
  const prepared = html.replaceAll(GHOST_URL_PLACEHOLDER, '');
  try {
    return { markdown: getTurndown().turndown(prepared).trim(), usedFallback: false, hadGhostUrls };
  } catch {
    return { markdown: htmlToPlainText(prepared), usedFallback: true, hadGhostUrls };
  }
};

/** Full page body for one Ghost item: optional leading feature image + converted HTML. */
export const ghostItemToMarkdown = (item: GhostContentItem): GhostHtmlConversion => {
  const source = item.html ?? '';
  const conversion = source ? convertGhostHtml(source) : { markdown: item.plaintext?.trim() ?? '', usedFallback: false, hadGhostUrls: false };
  if (item.featureImage) {
    const image = item.featureImage.replaceAll(GHOST_URL_PLACEHOLDER, '');
    const alt = item.title.replace(/[[\]\n]/g, ' ').trim();
    const hadGhostUrls = conversion.hadGhostUrls || item.featureImage.includes(GHOST_URL_PLACEHOLDER);
    return { ...conversion, hadGhostUrls, markdown: `![${alt}](${image})\n\n${conversion.markdown}`.trim() };
  }
  return conversion;
};
