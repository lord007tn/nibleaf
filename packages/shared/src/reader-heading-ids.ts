import GithubSlugger from 'github-slugger';

/*
 * The reader's heading ids: the one id generator the reader's renderer, the
 * search indexer and the chat's citation check all use (through
 * `@nibleaf/shared/reader-headings` for the last two). It is rehype-slug's
 * algorithm: every h1–h6 without an id, in document order, gets the
 * github-slugger slug of its text, so a repeated heading gets `-1`, `-2` and
 * the count runs across all six levels. An id the author set (which the
 * sanitizer has already prefixed) is kept and not counted.
 *
 * Kept free of parsers so the article renderer can import it without growing.
 */

/** The parts of a hast node the id generator reads. */
export interface ReaderHastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: ReaderHastNode[];
}

const HEADING = /^h[1-6]$/;

/** A node's text as the DOM's `textContent` reads it: its text descendants, in order. */
export const readerHastText = (node: ReaderHastNode): string =>
  node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(readerHastText).join('');

/** The heading level of a hast node (1–6), or 0 when it is not a heading. */
export const readerHeadingRank = (node: ReaderHastNode): number =>
  node.type === 'element' && node.tagName && HEADING.test(node.tagName) ? Number(node.tagName[1]) : 0;

/**
 * The reader's ids for one page's headings: call it with each heading's text,
 * in document order, and it returns that heading's id (a repeated text gets
 * `-1`, `-2`, …). The page editor names its headings with it, so a link to
 * `page#section` lands on the heading the reader would land on.
 */
export const readerHeadingIdGenerator = (): ((text: string) => string) => {
  const slugger = new GithubSlugger();
  return (text) => slugger.slug(text);
};

/** rehype plugin: gives the article's headings the reader's ids (see above). */
export function rehypeReaderHeadingIds() {
  return (tree: ReaderHastNode) => {
    const nextId = readerHeadingIdGenerator();
    const visit = (node: ReaderHastNode) => {
      if (readerHeadingRank(node)) {
        node.properties ??= {};
        if (!node.properties.id) node.properties.id = nextId(readerHastText(node));
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
}
