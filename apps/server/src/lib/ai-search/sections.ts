import { type SearchChunk, sectionHeadingKey } from '@nibleaf/search';
import { extractHeadings, type Heading, type SnapshotPage } from '@nibleaf/shared/site';

/** The longest section id a citation carries (`aiChatSourceSchema.anchor`). A
 * longer one is still a real section, but its link opens the page's top. */
const ANCHOR_MAX = 200;

type PublishedPage = Pick<SnapshotPage, 'id' | 'content' | 'kind' | 'hidden' | 'languageCode'>;

/** Gives a retrieved chunk the section it belongs to in the published page, or
 * nothing when that page does not render it. */
export type SectionResolver = (chunk: SearchChunk) => SearchChunk | undefined;

/**
 * Resolves each retrieved chunk to a section that exists in the published page
 * it came from, before the model reads it, so every citation the model can make
 * opens a real place on the page:
 *
 * 1. the anchor recorded when the chunk was indexed, if the page renders that id;
 * 2. otherwise (points indexed before anchors were recorded) the first heading the
 *    page renders with the text of the chunk's heading, then of its ancestors;
 * 3. the page's top for the text before any heading.
 *
 * The chunk's heading becomes the resolved section's heading as the table of
 * contents shows it, so a citation's label and its link always agree. A chunk
 * whose page is not one of `pages` (another version, or not a readable page), or
 * whose section the page does not render, is left out: it could only be cited
 * with a link to nowhere.
 */
export const publishedSections = (pages: readonly PublishedPage[]): SectionResolver => {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const headings = new Map<string, Heading[]>();
  const headingsOf = (page: PublishedPage) => {
    let list = headings.get(page.id);
    if (!list) {
      list = extractHeadings(page.content);
      headings.set(page.id, list);
    }
    return list;
  };
  return (chunk) => {
    const page = byId.get(chunk.pageId);
    if (page?.kind !== 'PAGE' || page.hidden || page.languageCode !== chunk.language) return;
    const { anchor: indexed, ...rest } = chunk;
    if (!indexed && !chunk.heading && chunk.headingPath.length === 0) return { ...rest, heading: '' };
    const list = headingsOf(page);
    let section = indexed ? list.find((heading) => heading.id === indexed) : undefined;
    for (const text of section ? [] : [chunk.heading, ...[...chunk.headingPath].reverse()]) {
      const key = sectionHeadingKey(text);
      section = key ? list.find((heading) => sectionHeadingKey(heading.text) === key) : undefined;
      if (section) break;
    }
    if (!section) return;
    return section.id.length <= ANCHOR_MAX ? { ...rest, heading: section.text, anchor: section.id } : { ...rest, heading: section.text };
  };
};
