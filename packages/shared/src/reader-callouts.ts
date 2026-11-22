import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { documentationComponentContractEntries } from './documentation-component-contract';
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

/** The reader tags of the components whose Markdown body the reader renders (`markdownBody`). */
const BODY_TAGS: ReadonlySet<string> = new Set(
  documentationComponentContractEntries().flatMap(([tag, component]) => (component.markdownBody ? [(component.readerTag ?? tag).toLowerCase()] : [])),
);

/** The marker a callout carries, when its element holds just that one plain paragraph, as the
 *  reader renders `<Name>body</Name>` with a plain-text body. */
const paragraphText = (element: ReaderHastNode): string | undefined => {
  const blocks = (element.children ?? []).filter((child) => !(child.type === 'text' && (child.value ?? '').trim() === ''));
  const [paragraph] = blocks;
  if (blocks.length !== 1 || paragraph?.type !== 'element' || paragraph.tagName !== 'p') return undefined;
  const [text] = paragraph.children ?? [];
  return paragraph.children?.length === 1 && text?.type === 'text' ? text.value : undefined;
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
export const readerRenderedCallouts = (lines: readonly string[], callouts: readonly CalloutLine[]): Set<number> => {
  const shown = new Set<number>();
  if (callouts.length === 0) return shown;
  const page = lines.slice();
  // A run of `q` longer than any on the page can't be part of it.
  let longest = 0;
  for (const line of page) for (const run of line.match(/q+/g) ?? []) longest = Math.max(longest, run.length);
  const tag = `nibleaf${'q'.repeat(longest + 1)}callout`;
  for (const [index, callout] of callouts.entries()) page[callout.line] = `<${callout.name}>${tag}${index}x</${callout.name}>`;
  const normalized = normalizeMdxBlocks(page.join('\n'));
  // The last marker the reader still has, and the end of the line that closes its callout.
  let last: RegExpExecArray | undefined;
  for (const match of normalized.matchAll(new RegExp(`${tag}(\\d+)x`, 'g'))) last = match;
  if (!last) return shown;
  const closer = normalized.indexOf(`</${callouts[Number(last[1])]?.name}>`, last.index);
  const lineEnd = closer < 0 ? -1 : normalized.indexOf('\n', closer);
  const parsed = lineEnd < 0 ? normalized : normalized.slice(0, lineEnd);
  if (parsed.length > MAX_PARSED_LENGTH) return shown;
  let lineCount = 1;
  for (let at = parsed.indexOf('\n'); at >= 0 && lineCount <= MAX_PARSED_LINES; at = parsed.indexOf('\n', at + 1)) lineCount += 1;
  if (lineCount > MAX_PARSED_LINES || (parsed.match(PARSE_MARKERS)?.length ?? 0) > MAX_PARSED_MARKERS) return shown;
  const tree = reader.runSync(reader.parse(parsed)) as unknown as ReaderHastNode;
  const expected = new Map(callouts.map((callout, index) => [`${tag}${index}x`, callout]));
  // Only the page and the components that render their body are entered (an element tree can be deep).
  const pending: ReaderHastNode[] = [tree];
  while (pending.length > 0) {
    const node = pending.pop() as ReaderHastNode;
    for (const child of node.children ?? []) {
      if (child.type !== 'element' || !child.tagName || !BODY_TAGS.has(child.tagName)) continue;
      const callout = expected.get(paragraphText(child) ?? '');
      if (callout && child.tagName === callout.name.toLowerCase()) shown.add(callout.line);
      pending.push(child);
    }
  }
  return shown;
};
