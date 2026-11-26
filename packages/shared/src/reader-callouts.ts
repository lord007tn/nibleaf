import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import {
  documentationComponentContractEntries,
  documentationReaderTag,
  READER_TAGS_WITHOUT_MARKDOWN_CHILDREN,
} from './documentation-component-contract';
import type { ReaderHastNode } from './reader-heading-ids';
import { normalizeMdxBlocks } from './reader-markdown';
import { readerSanitizeSchema } from './reader-sanitize';

/*
 * Which one-line callouts the published reader shows as callouts, read from the tree it renders
 * (#591's Markdown export, #917 re-check). The rich renderer's own steps, as in ./reader-headings:
 * the reader's normalization, CommonMark + GFM + math, raw HTML parsed and then sanitized with the
 * reader's schema. The reader adds math only to pages that have some
 * (apps/app/src/components/markdown-rich.tsx); a page without math parses the same either way.
 * Its later steps restyle or wrap elements and never drop a callout or move one out of another
 * block. Server and worker only: it loads the Markdown and HTML parsers.
 */

const reader = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, readerSanitizeSchema)
  .freeze();

/**
 * How much of the reader's normalized page this check parses. micromark goes superlinear on long
 * runs of emphasis, bracket and tag markers (#453), and costs about 0.1 ms a paragraph, so past
 * these bounds export keeps main's bytes. Every page of the 364-page docs corpus but four fits
 * whole (the largest is 1,289 lines, 108 KB and 2,065 markers), and the check parses only up to
 * the last callout.
 */
const MAX_PARSED_LENGTH = 65_536;
const MAX_PARSED_LINES = 1024;
const MAX_PARSED_MARKERS = 2048;
const PARSE_MARKERS = /[*_[\]<>`$!&]/g;
const FIRST_PRIVATE_USE = 0xe0_00;
const PRIVATE_USE_COUNT = 6400;

/** A short prefix absent even after the normalizer joins text across removed comments. */
const calloutMarker = (source: string): string => {
  const counts = new Uint32Array(PRIVATE_USE_COUNT);
  for (const [character] of source.matchAll(/[\uE000-\uF8FF]/g)) {
    const index = character.charCodeAt(0) - FIRST_PRIVATE_USE;
    counts[index] = (counts[index] ?? 0) + 1;
  }
  let leastUsed = 0;
  for (let index = 1; index < counts.length && counts[leastUsed] !== 0; index++) {
    if ((counts[index] ?? 0) < (counts[leastUsed] ?? 0)) leastUsed = index;
  }
  return String.fromCharCode(FIRST_PRIVATE_USE + leastUsed).repeat((counts[leastUsed] ?? 0) + 1);
};

const CHILDLESS_TAGS: ReadonlySet<string> = new Set(READER_TAGS_WITHOUT_MARKDOWN_CHILDREN);
/** Components that parse their body as Markdown and pass their children to the reader. */
const BODY_TAGS: ReadonlySet<string> = new Set(
  documentationComponentContractEntries().flatMap(([tag, component]) => {
    const name = documentationReaderTag(tag);
    return component.markdownBody && !CHILDLESS_TAGS.has(name) ? [name] : [];
  }),
);

interface PositionedNode extends ReaderHastNode {
  children?: PositionedNode[];
  position?: { start: { offset?: number } };
}

/** The offset of the single plain-text paragraph rendered inside a callout. */
const paragraphOffset = (element: PositionedNode): number | undefined => {
  const blocks = (element.children ?? []).filter((child) => !(child.type === 'text' && (child.value ?? '').trim() === ''));
  const [paragraph] = blocks;
  if (blocks.length !== 1 || paragraph?.type !== 'element' || paragraph.tagName !== 'p') return undefined;
  const [text] = paragraph.children ?? [];
  return paragraph.children?.length === 1 && text?.type === 'text' ? text.position?.start.offset : undefined;
};

const withinParseBudget = (source: string): boolean => {
  if (source.length > MAX_PARSED_LENGTH) return false;
  let lineCount = 1;
  for (let at = source.indexOf('\n'); at >= 0; at = source.indexOf('\n', at + 1)) if (++lineCount > MAX_PARSED_LINES) return false;
  let markers = 0;
  for (const _ of source.matchAll(PARSE_MARKERS)) if (++markers > MAX_PARSED_MARKERS) return false;
  return true;
};

/** A complete one-line callout with a plain-text body: `<Name>body</Name>`. */
export interface CalloutLine {
  line: number;
  name: string;
}

/**
 * The callouts in `callouts` that the reader renders as a callout of their own name, holding their
 * body as a paragraph, and nested only in components whose Markdown body the reader renders: not
 * inside math, code, a raw-text element such as `<textarea>`, `<pre>`, a list, a quote or any
 * other element. Each body is swapped for a marker the page doesn't contain, a plain word as the
 * body was. The reader normalizes the whole page (MDX comments may close after a callout), and the
 * parse stops after the last callout's closing tag: CommonMark reads blocks forward and the HTML
 * parser never moves an element it has closed, so what follows can't change how a callout before
 * it renders.
 */
export const readerRenderedCallouts = (source: string, lines: readonly string[], callouts: readonly CalloutLine[]): Set<number> => {
  const shown = new Set<number>();
  if (callouts.length === 0) return shown;
  // Each normalized candidate takes at least four tag delimiters. The full
  // budget is checked after normalization, which can remove long comments.
  if (callouts.length * 4 > MAX_PARSED_MARKERS) return shown;

  const marker = calloutMarker(source);
  const page = lines.slice();
  for (const [index, callout] of callouts.entries()) {
    page[callout.line] = `<${callout.name}>${marker}${index}x</${callout.name}>`;
  }
  const normalized = normalizeMdxBlocks(page.join('\n'));
  const pattern = new RegExp(`${marker}(\\d+)x`, 'g');
  let last: RegExpExecArray | undefined;
  for (const match of normalized.matchAll(pattern)) last = match;
  if (!last) return shown;
  const closer = normalized.indexOf(`</${callouts[Number(last[1])]?.name}>`, last.index);
  const lineEnd = closer < 0 ? -1 : normalized.indexOf('\n', closer);
  const parsed = lineEnd < 0 ? normalized : normalized.slice(0, lineEnd);
  if (!withinParseBudget(parsed)) return shown;
  const tree = reader.runSync(reader.parse(parsed)) as unknown as PositionedNode;
  // Match a parsed body to its source offset, so entity-decoded text cannot
  // select an unrelated callout.
  const expected = new Map<number, CalloutLine | undefined>();
  for (const match of parsed.matchAll(pattern)) expected.set(match.index, callouts[Number(match[1])]);
  // Only the page and the components that render their body are entered (an element tree can be deep).
  const pending: PositionedNode[] = [tree];
  while (pending.length > 0) {
    const node = pending.pop() as PositionedNode;
    for (const child of node.children ?? []) {
      if (child.type !== 'element' || !child.tagName || !BODY_TAGS.has(child.tagName)) continue;
      const callout = expected.get(paragraphOffset(child) ?? -1);
      if (callout && child.tagName === callout.name.toLowerCase()) shown.add(callout.line);
      pending.push(child);
    }
  }
  return shown;
};
