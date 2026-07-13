/**
 * Blog article registry, derived from the MDX files in `src/content/blog/**`.
 *
 * Each article carries its own YAML frontmatter (remark-mdx-frontmatter turns it
 * into `export const frontmatter`), so adding an article means adding one .mdx
 * file — the blog index, sitemap, llms.txt, and the routes all pick it up with
 * no registry edit and no codegen step.
 *
 * This module only globs the `frontmatter` export, so pages that render article
 * METADATA (landing teaser, blog index, sitemap) tree-shake the compiled bodies
 * out of their bundles. The article bodies live in lib/blog-components.ts,
 * imported only by the /blog/$slug route.
 */
const MDX_EXTENSION_RE = /\.mdx$/;

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
  /** Visible Q&A, also emitted as FAQPage JSON-LD. */
  faqs?: BlogFaq[];
  /** Word-count-derived reading estimate in minutes. */
  readingMinutes?: number;
  /** Slugs of related articles rendered as a "read next" rail. */
  related?: string[];
  /** URL slug, derived from the filename — /blog/<slug>. */
  slug: string;
  /** Editorial tags, rendered as chips on the index cards. */
  tags?: string[];
  title: string;
}

type Frontmatter = Omit<BlogEntry, 'slug'>;

const frontmatterModules = import.meta.glob<Frontmatter>('../content/blog/*.mdx', {
  eager: true,
  import: 'frontmatter',
});

const slugOf = (file: string) => file.split('/').pop()?.replace(MDX_EXTENSION_RE, '') ?? file;

/** All articles, newest first. */
export const BLOG_ENTRIES: BlogEntry[] = Object.entries(frontmatterModules)
  .map(([file, frontmatter]) => ({ ...frontmatter, slug: slugOf(file) }))
  .sort((a, b) => b.datePublished.localeCompare(a.datePublished) || a.slug.localeCompare(b.slug));

const entriesBySlug = new Map(BLOG_ENTRIES.map((entry) => [entry.slug, entry]));

export const blogEntry = (slug: string) => entriesBySlug.get(slug);

/** Reading-time estimate in minutes, defaulting when the frontmatter omits it. */
export const blogReadingMinutes = (entry: BlogEntry) => entry.readingMinutes ?? 5;
