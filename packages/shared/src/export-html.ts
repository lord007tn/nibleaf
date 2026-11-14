import type { Element, Root, RootContent } from 'hast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { Tokenizer } from 'parse5';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { unified } from 'unified';
import { readerSanitizeSchema } from './reader-sanitize';

const sanitize = rehypeSanitize(readerSanitizeSchema);
const htmlParser = unified().use(rehypeRaw);
const elementsByOffset = (root: Root): Map<number, Element> => {
  const elements = new Map<number, Element>();
  const pending: (Root | RootContent)[] = [root];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    const offset = node.position?.start.offset;
    if (node.type === 'element' && offset !== undefined) elements.set(offset, node);
    if ('children' in node) for (const child of node.children) pending.push(child);
  }
  return elements;
};

const keepsElement = (original: Element, clean: Element | undefined): boolean =>
  original.tagName === clean?.tagName &&
  Object.entries(original.properties).every(([name, value]) => {
    const kept = clean.properties[name];
    // The reader prefixes IDs/names to prevent DOM clobbering; that keeps the attribute.
    if (readerSanitizeSchema.clobber?.includes(name) && kept === `${readerSanitizeSchema.clobberPrefix}${value}`) return true;
    return JSON.stringify(value) === JSON.stringify(kept);
  });

/** Check the *projected* Markdown, not the MDX tokenizer's code guesses. Its quote/list
 * fence can end before the tokenizer thinks it does (#633). CommonMark identifies the
 * HTML a downstream renderer sees; parse5 and the reader schema decide what is allowed.
 * Escape only rejected delimiters (and raw-text contents), never discard author text or
 * serialize the document. Allowed sibling/child tags and real code retain their bytes. */
export const escapeDisallowedExportHtml = (source: string): string => {
  if (!source.includes('<')) return source;
  const markdown = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const escaped = new Uint8Array(source.length);
  const blockEnds = new Set<number>();
  const pending = markdown.children.map((node) => ({ node, inline: false }));
  while (pending.length) {
    const entry = pending.pop();
    if (!entry) continue;
    const { node, inline } = entry;
    if ('children' in node) {
      for (const child of node.children) pending.push({ node: child, inline: ['paragraph', 'heading', 'tableCell'].includes(node.type) });
    }
    if (node.type !== 'html') continue;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    let changed = false;
    const mark = (from: number, to: number) => {
      for (let at = from; at < to; at++) {
        if (source[at] !== '<') continue;
        escaped[at] = 1;
        changed = true;
      }
    };
    // Slice source rather than node.value: container prefixes must keep their offsets.
    const value = source.slice(start, end);
    const tree = htmlParser.runSync({ type: 'root', children: [{ type: 'raw', value }] }, value) as Root;
    const original = elementsByOffset(tree);
    const clean = elementsByOffset(sanitize(tree));
    for (const [offset, element] of original) {
      if (keepsElement(element, clean.get(offset))) continue;
      // Escaping a raw-text opener exposes its literal contents to HTML parsing.
      for (const child of element.children) {
        if (child.type === 'text' && child.position?.start.offset !== undefined && child.position.end.offset !== undefined) {
          mark(start + child.position.start.offset, start + child.position.end.offset);
        }
      }
    }
    // The tree builder ignores unmatched closing tags and declarations. They still
    // need escaping when the reader does not allow them; use HTML tokens, not a tag regex.
    const tags = new Tokenizer(
      { sourceCodeLocationInfo: true },
      {
        onStartTag: (token) => {
          if (!token.location) return;
          const before = original.get(token.location.startOffset);
          if (!before || !keepsElement(before, clean.get(token.location.startOffset))) {
            mark(start + token.location.startOffset, start + token.location.endOffset);
          }
        },
        onEndTag: (token) => {
          if (!readerSanitizeSchema.tagNames?.includes(token.tagName) && token.location) {
            mark(start + token.location.startOffset, start + token.location.endOffset);
          }
        },
        onDoctype: (token) => {
          if (token.location) mark(start + token.location.startOffset, start + token.location.endOffset);
        },
        onComment: (token) => {
          if (token.location) mark(start + token.location.startOffset, start + token.location.endOffset);
        },
        onEof: () => undefined,
        onCharacter: () => undefined,
        onNullCharacter: () => undefined,
        onWhitespaceCharacter: () => undefined,
      },
    );
    tags.write(value, true);
    // Fences/backticks inside an HTML node were literal text. Once its opening tag
    // is escaped they must stay literal: a newly opened fence could otherwise close
    // at a later real fence and expose HTML that was originally in code.
    if (changed) {
      // HTML blocks cannot lazily continue a surrounding list/quote paragraph.
      // Keep that boundary when the escaped opener becomes ordinary prose.
      if (!inline && end < source.length && !source.startsWith('\n\n', end) && !source.startsWith('\r\n\r\n', end)) blockEnds.add(end);
      for (let at = start; at < end; at++) {
        if (source[at] === '`' || source[at] === '~') escaped[at] = 2;
      }
    }
  }
  const parts: string[] = [];
  let cursor = 0;
  for (let at = 0; at < source.length; at++) {
    if (blockEnds.has(at)) {
      parts.push(source.slice(cursor, at), '\n');
      cursor = at;
    }
    if (!escaped[at]) continue;
    parts.push(source.slice(cursor, at), escaped[at] === 1 ? '&lt;' : source[at] === '`' ? '&#96;' : '&#126;');
    cursor = at + 1;
  }
  parts.push(source.slice(cursor));
  return parts.join('');
};
