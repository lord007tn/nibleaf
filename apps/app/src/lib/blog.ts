/**
 * Blog article registry, derived from the MDX files in `src/content/blog/**`.
 *
 * Production imports a lightweight manifest so article prose does not leak into
 * the homepage bundle. A test deep-compares the manifest with every MDX
 * frontmatter object, so adding or editing an article requires updating both and
 * cannot silently desynchronize cards, sitemap, JSON-LD, and the article route.
 */
import { BLOG_MANIFEST } from './blog-manifest';

export interface BlogFaq {
  answer: string;
  question: string;
}

export interface BlogEntry {
  /** ISO date the article was last materially updated (drives sitemap lastmod + JSON-LD). */
  dateModified: string;
  datePublished: string;
  /** Plain summary used for meta description, index card, and llms.txt. */
  description: string;
  /** Language of the article body and metadata. Defaults to English. */
  language?: 'ar' | 'en';
  /** Optional search title when the visible headline would be too long. */
  metaTitle?: string;
  /** Visible Q&A, also emitted as FAQPage JSON-LD. */
  faqs?: BlogFaq[];
  /** Word-count-derived reading estimate in minutes. */
  readingMinutes?: number;
  /** Slugs of related articles rendered as a "read next" rail. */
  related?: string[];
  /** Slug of the same article in another language, for reciprocal hreflang. */
  translationOf?: string;
  /** URL slug, derived from the filename — /blog/<slug>. */
  slug: string;
  /** Editorial tags, rendered as chips on the index cards. */
  tags?: string[];
  title: string;
}

/** All articles, newest first. */
export const BLOG_ENTRIES: BlogEntry[] = [...BLOG_MANIFEST]
  .sort((a, b) => b.datePublished.localeCompare(a.datePublished) || a.slug.localeCompare(b.slug));

const entriesBySlug = new Map(BLOG_ENTRIES.map((entry) => [entry.slug, entry]));

export const blogEntry = (slug: string) => entriesBySlug.get(slug);

/** Reading-time estimate in minutes, defaulting when the frontmatter omits it. */
export const blogReadingMinutes = (entry: BlogEntry) => entry.readingMinutes ?? 5;

export const blogLanguage = (entry: BlogEntry): 'ar' | 'en' => entry.language ?? 'en';
