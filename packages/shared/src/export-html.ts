import type { Element, Root, RootContent } from 'hast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { Tokenizer } from 'parse5';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { readerSanitizeSchema } from './reader-sanitize';

const sanitize = rehypeSanitize(readerSanitizeSchema);
const htmlParser = unified().use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw);
const MAX_PARSE_CHARACTERS = 262_144;
const MAX_CONTAINER_PREFIX = 128;
const MAX_HTML_DEPTH = 64;
// Structural accounting only; the reader schema remains the HTML allow-list.
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const escapeUnparsed = (source: string): string => source.replaceAll('<', '&lt;').replaceAll('[', '&#91;');

/** Bound parser input before any recursive library traversal. A conservative
 * prefix/depth count may escape more text, but can never discard it or let it run. */
const exceedsParserBudget = (source: string): boolean => {
  if (source.length > MAX_PARSE_CHARACTERS) return true;
  let prefix = 0;
  let atPrefix = true;
  for (const character of source) {
    if (character === '\n') {
      prefix = 0;
      atPrefix = true;
    } else if (atPrefix) {
      if (' >\t-*+0123456789.)'.includes(character)) {
        if (++prefix > MAX_CONTAINER_PREFIX) return true;
      } else atPrefix = false;
    }
  }
  const stack: string[] = [];
  let exceeded = false;
  const tokens = new Tokenizer(
    {},
    {
      onStartTag: ({ tagName, selfClosing }) => {
        if (selfClosing || VOID_ELEMENTS.has(tagName)) return;
        stack.push(tagName);
        if (stack.length > MAX_HTML_DEPTH) {
          exceeded = true;
          tokens.pause();
        }
      },
      onEndTag: ({ tagName }) => {
        const index = stack.lastIndexOf(tagName);
        if (index >= 0) stack.length = index;
      },
      onComment: () => undefined,
      onDoctype: () => undefined,
      onEof: () => undefined,
      onCharacter: () => undefined,
      onNullCharacter: () => undefined,
      onWhitespaceCharacter: () => undefined,
    },
  );
  tokens.write(source, true);
  return exceeded;
};
const elementsByOffset = (root: Root): Map<number, Element> => {
  const elements = new Map<number, Element>();
  const pending: (Root | RootContent)[] = [root];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    const offset = node.position?.start?.offset;
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
  if (!source.includes('<') && !source.includes('[')) return source;
  if (exceedsParserBudget(source)) return escapeUnparsed(source);
  try {
    return escapeParsedHtml(source);
  } catch (error) {
    // A library may encounter a recursive shape beyond the conservative preflight.
    // Preserve it as inert source; other errors must remain visible.
    if (error instanceof RangeError) return escapeUnparsed(source);
    throw error;
  }
};

const escapeParsedHtml = (source: string): string => {
  const markdown = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const tree = htmlParser.runSync(markdown, source);
  const original = elementsByOffset(tree);
  const clean = elementsByOffset(sanitize(tree));
  const escaped = new Uint8Array(source.length);
  const blockEnds = new Set<number>();
  const markAngles = (from: number, to: number): boolean => {
    let changed = false;
    for (let at = from; at < to; at++) {
      if (source[at] !== '<') continue;
      escaped[at] = 1;
      changed = true;
    }
    return changed;
  };
  for (const [offset, element] of original) {
    if (keepsElement(element, clean.get(offset))) continue;
    // Escaping a raw-text opener exposes its literal contents to HTML parsing.
    for (const child of element.children) {
      if (child.type === 'text' && child.position?.start?.offset !== undefined && child.position.end?.offset !== undefined) {
        markAngles(child.position.start.offset, child.position.end.offset);
      }
    }
  }
  const pending = markdown.children.map((node) => ({ node, inline: false }));
  while (pending.length) {
    const entry = pending.pop();
    if (!entry) continue;
    const { node, inline } = entry;
    if ('children' in node) {
      for (const child of node.children) pending.push({ node: child, inline: ['paragraph', 'heading', 'tableCell'].includes(node.type) });
    }
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    // Use the reader's actual data-URL decision for inline and reference links/images.
    // This also covers destinations exposed by a projected container. Rejected
    // URLs stay as literal source, with their labels and destinations preserved.
    if (['link', 'image', 'linkReference', 'imageReference'].includes(node.type)) {
      const element = original.get(start);
      const property = element?.tagName === 'img' ? 'src' : 'href';
      const address = Array.from(String(element?.properties[property] ?? '').toLowerCase())
        .filter((character) => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127)
        .join('');
      if (address.startsWith('data:') && clean.get(start)?.properties[property] === undefined) {
        markAngles(start, end);
        for (let at = start; at < end; at++) if (source[at] === '[') escaped[at] = 3;
      }
      continue;
    }
    if (node.type !== 'html') continue;
    let changed = false;
    const mark = (from: number, to: number) => {
      changed = markAngles(from, to) || changed;
    };
    // Slice source rather than node.value: container prefixes must keep their offsets.
    const value = source.slice(start, end);
    // The tree builder ignores unmatched closing tags and declarations. They still
    // need escaping when the reader does not allow them; use HTML tokens, not a tag regex.
    const tags = new Tokenizer(
      { sourceCodeLocationInfo: true },
      {
        onStartTag: (token) => {
          if (!token.location) return;
          const before = original.get(start + token.location.startOffset);
          if (!before || !keepsElement(before, clean.get(start + token.location.startOffset))) {
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
    // Markdown inside an HTML node was literal text. Once its opener is escaped,
    // keep fences and link/image brackets literal: they must not expose later HTML
    // or turn a previously inert data: destination into a live href/src.
    if (changed) {
      // HTML blocks cannot lazily continue a surrounding list/quote paragraph.
      // Keep that boundary when the escaped opener becomes ordinary prose.
      if (!inline && end < source.length && !source.startsWith('\n\n', end) && !source.startsWith('\r\n\r\n', end)) blockEnds.add(end);
      for (let at = start; at < end; at++) {
        if (source[at] === '`' || source[at] === '~') escaped[at] = 2;
        if (source[at] === '[') escaped[at] = 3;
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
    parts.push(source.slice(cursor, at), escaped[at] === 1 ? '&lt;' : escaped[at] === 3 ? '&#91;' : source[at] === '`' ? '&#96;' : '&#126;');
    cursor = at + 1;
  }
  parts.push(source.slice(cursor));
  return parts.join('');
};
