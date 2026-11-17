import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { markdownLineKinds } from './markdown-code';
import { type ReaderHastNode, readerHastText, readerHeadingRank, rehypeReaderHeadingIds } from './reader-heading-ids';
import { normalizeMdxBlocks } from './reader-markdown';
import { readerRenderMode } from './reader-render-mode';
import { readerSanitizeSchema } from './reader-sanitize';

/*
 * A page's headings exactly as the reader renders them: the one heading parser
 * the search indexer and the chat's citation check use, built from the article
 * renderer's own steps (apps/app/src/components/markdown.tsx). It normalizes
 * MDX blocks, parses with GFM (and math on rich pages), keeps raw HTML on rich
 * pages, sanitizes with the reader's schema, typesets math, and gives ids with
 * the reader's id generator (`./reader-heading-ids`). The renderer's other
 * steps (callouts, code titles, component props, Mermaid, text direction) never
 * add, drop or reword a heading. A differential test renders pages with the
 * real renderer and compares (apps/app/src/components/reader-headings.test.tsx).
 *
 * Server and worker only: it loads the full Markdown, HTML and KaTeX stack.
 */

export interface ReaderHeading {
  /** 1–6. */
  depth: number;
  /** The heading's text as the page shows it (its DOM `textContent`, trimmed). */
  text: string;
  /** The heading's DOM id. */
  id: string;
}

const base = unified()
  .use(remarkParse)
  .use(remarkGfm)
  // react-markdown's own setting; without rehype-raw the HTML is not parsed.
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeSanitize, readerSanitizeSchema)
  .use(rehypeReaderHeadingIds)
  .freeze();
const rich = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, readerSanitizeSchema)
  .use(rehypeKatex, { trust: false })
  .use(rehypeReaderHeadingIds)
  .freeze();

const headingsOf = (tree: ReaderHastNode, into: ReaderHeading[] = []): ReaderHeading[] => {
  const depth = readerHeadingRank(tree);
  if (depth) into.push({ depth, text: readerHastText(tree).trim(), id: String(tree.properties?.id ?? '') });
  for (const child of tree.children ?? []) headingsOf(child, into);
  return into;
};

/** Every h1–h6 the reader renders for this page, in document order, with its id and text. */
export const readerHeadings = (content: string): ReaderHeading[] => {
  const processor = readerRenderMode(content).rich ? rich : base;
  const tree = processor.runSync(processor.parse(normalizeMdxBlocks(content))) as unknown as ReaderHastNode;
  return headingsOf(tree);
};

/** A rendered heading at the line of the page's source where it is written. */
export interface ReaderSection extends ReaderHeading {
  /** 0-based line of `content.split('\n')`: the heading's line (a setext heading's text line). */
  line: number;
  /** The heading as written in the source (ATX marks and closing hashes removed). */
  source: string;
}

/** Heading text compared across source and rendering: letters and digits only (any script), case-folded.
 *  The page editor matches its headings to the reader's with it too. */
export const readerHeadingKey = (text: string) =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** An ATX heading line (up to three spaces of indent, 1–6 `#`, then a space or the end). */
const atxHeading = (line: string): { depth: number; text: string } | undefined => {
  let start = 0;
  while (start < 3 && line[start] === ' ') start += 1;
  let depth = 0;
  while (depth < 7 && line[start + depth] === '#') depth += 1;
  if (depth < 1 || depth > 6) return undefined;
  const after = line[start + depth];
  if (after !== undefined && after !== ' ' && after !== '\t') return undefined;
  let text = line.slice(start + depth).trim();
  // A closing sequence of hashes (preceded by a space, or the whole text) is not part of the heading.
  const closing = /(?:^|[ \t])#+$/.exec(text);
  if (closing) text = text.slice(0, closing.index).trim();
  return { depth, text };
};
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const QUIET_LINE = /^ {0,3}(?:[-*+>]|\d{1,9}[.)]|$)/;

/** The heading lines of a page's source, outside fenced code and HTML blocks (the shared scanner). */
const sourceHeadings = (lines: readonly string[]) => {
  const kinds = markdownLineKinds(lines);
  const found: { line: number; depth: number; text: string }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (kinds[index] !== 'prose') continue;
    const line = (lines[index] ?? '').replace(/\r$/, '');
    const atx = atxHeading(line);
    if (atx) {
      found.push({ line: index, ...atx });
      continue;
    }
    const next = (lines[index + 1] ?? '').replace(/\r$/, '');
    if (kinds[index + 1] === 'prose' && SETEXT_UNDERLINE.test(next) && line.trim() && !QUIET_LINE.test(line))
      found.push({ line: index, depth: next.trim().startsWith('=') ? 1 : 2, text: line.trim() });
  }
  return found;
};

/** The source text of a heading as the reader would render it on its own (entities
 * decoded, inline Markdown and HTML tags dropped), for matching. */
const renderedSourceText = (depth: number, text: string): string => {
  const tree = base.runSync(base.parse(`${'#'.repeat(depth)} ${text}`)) as unknown as ReaderHastNode;
  return headingsOf(tree)[0]?.text ?? text;
};

/**
 * The page's rendered headings, each at the source line where it is written, so
 * the indexer can cut sections at real headings and record their real ids. The
 * source's heading lines (outside fenced code and HTML blocks, by the shared scanner) are
 * matched to the rendered headings in document order: each takes the next
 * rendered heading of the same level whose text matches, or, when it holds math
 * (which renders differently on its own), the rendered heading at the same place
 * if it has the same level. A line the reader does not render as a heading (a
 * `#` line inside HTML, say) matches none and is not a section; a heading the
 * source does not write as a line (raw HTML) keeps its id but has no section.
 */
export const readerSections = (content: string): ReaderSection[] => {
  const rendered = readerHeadings(content);
  const lines = content.split('\n');
  const sections: ReaderSection[] = [];
  let cursor = 0;
  for (const candidate of sourceHeadings(lines)) {
    const key = readerHeadingKey(renderedSourceText(candidate.depth, candidate.text));
    let found = -1;
    for (let index = cursor; key && index < rendered.length; index += 1) {
      const heading = rendered[index];
      if (heading?.depth === candidate.depth && readerHeadingKey(heading.text) === key) {
        found = index;
        break;
      }
    }
    // Math is the one thing a heading's own text renders differently (KaTeX adds its
    // MathML); anything else that does not match is not a heading the reader renders,
    // and pairing it by place would shift every later section's id.
    if (found < 0 && candidate.text.includes('$') && rendered[cursor]?.depth === candidate.depth) found = cursor;
    const heading = rendered[found];
    if (!heading) continue;
    sections.push({ ...heading, line: candidate.line, source: candidate.text });
    cursor = found + 1;
  }
  return sections;
};
