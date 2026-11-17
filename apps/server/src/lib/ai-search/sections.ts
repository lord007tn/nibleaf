import { type SearchChunk, sectionHeadingKey } from '@nibleaf/search';
import { type ReaderHeading, readerHeadings } from '@nibleaf/shared/reader-headings';
import type { SnapshotPage } from '@nibleaf/shared/site';
import { LruCache } from '@/lib/lru';

/** The longest section id a citation carries (`aiChatSourceSchema.anchor`). A
 * longer one is still a real section, but its link opens the page's top. */
const ANCHOR_MAX = 200;
/** Pages whose rendered headings are kept, weighed by heading count: a published
 * deployment's pages never change, so they are read once, not on every turn. */
const HEADINGS_CACHE_WEIGHT = 50_000;

type PublishedPage = Pick<SnapshotPage, 'id' | 'content' | 'kind' | 'hidden' | 'languageCode'>;

/** Rendered headings by (deployment, page, language): content-addressed by the
 * immutable published snapshot, so an entry is never stale. Only the parse is
 * shared; each request still checks the page against its own readable pages. */
const headingsCache = new LruCache<string, ReaderHeading[]>(HEADINGS_CACHE_WEIGHT, (headings) => Math.max(1, headings.length));

/** Gives a retrieved chunk the section it belongs to in the published page, or
 * nothing when that page does not render it. */
export type SectionResolver = (chunk: SearchChunk) => SearchChunk | undefined;

/**
 * Resolves each retrieved chunk to a section of the published page it came from,
 * before the model reads it, so every citation the model can make opens a real
 * place. The page's headings are read the way the reader renders them
 * (`readerHeadings`: the reader's own parser and id generator).
 *
 * - A chunk indexed with an anchor keeps it if the page renders that id, and is
 *   left out otherwise: its recorded section is gone, and guessing by text could
 *   open another one.
 * - A chunk indexed before anchors were recorded is matched by its heading's text,
 *   then its ancestors'; an h5/h6 match links to its nearest h1–h4 heading, as the
 *   indexer links them.
 * - Text before any heading cites the page's top.
 *
 * The chunk's heading becomes the section's heading as the page shows it, so a
 * citation's label and its link agree. A chunk whose page is not one of `pages`
 * (another version, a hidden page, not a page, the translation) is left out.
 */
export const publishedSections = (pages: readonly PublishedPage[], deploymentId: string): SectionResolver => {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const headingsOf = (page: PublishedPage) => {
    const key = JSON.stringify([deploymentId, page.id, page.languageCode]);
    let list = headingsCache.get(key);
    if (!list) {
      list = readerHeadings(page.content);
      headingsCache.set(key, list);
    }
    return list;
  };
  return (chunk) => {
    const page = byId.get(chunk.pageId);
    if (page?.kind !== 'PAGE' || page.hidden || page.languageCode !== chunk.language) return;
    const { anchor: indexed, ...rest } = chunk;
    if (!indexed && !chunk.heading && chunk.headingPath.length === 0) return { ...rest, heading: '' };
    const list = headingsOf(page);
    let index = -1;
    if (indexed) index = list.findIndex((heading) => heading.id === indexed);
    else
      for (const text of [chunk.heading, ...[...chunk.headingPath].reverse()]) {
        const key = sectionHeadingKey(text);
        index = key ? list.findIndex((heading) => sectionHeadingKey(heading.text) === key) : -1;
        if (index >= 0) {
          // h5/h6: the nearest h1–h4 before it, as the indexer links them.
          while (index >= 0 && (list[index]?.depth ?? 0) > 4) index -= 1;
          break;
        }
      }
    const section = list[index];
    if (!section) return;
    return section.id.length <= ANCHOR_MAX ? { ...rest, heading: section.text, anchor: section.id } : { ...rest, heading: section.text };
  };
};
