import { fencedMarkdownLines } from './markdown-code';

/*
 * Whether a page needs the reader's rich renderer (raw HTML/MDX components or
 * math). The reader's page code imports this, so it stays a line scan with no
 * parser; `readerRenderMode` (./reader-render-mode) refines it with one.
 *
 * Each check is a single forward scan, so detection time grows linearly with
 * the page. The HTML-tag and math checks are shared with the code-usage reader
 * (./markdown-code-usage) and search's snippet text, so all read text alike.
 */

const isLetter = (code: number) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const SLASH = 47;
const BACKTICK = 96;
const BACKSLASH = 92;

/** Where an HTML or component tag opened at `index` has its name: after `<`
 * and an optional `/`, when that is a Latin letter; -1 when it is not a tag. */
const tagName = (text: string, index: number): number => {
  const letter = text.charCodeAt(index + 1) === SLASH ? index + 2 : index + 1;
  return isLetter(text.charCodeAt(letter)) ? letter : -1;
};

/** Whether the text holds a tag: `<`, an optional `/`, a Latin letter, and a
 * `>` somewhere after the letter. The earliest tag start leaves the most text
 * for its `>`, so it alone decides. */
export const containsHtmlTag = (text: string): boolean => {
  for (let index = text.indexOf('<'); index >= 0; index = text.indexOf('<', index + 1)) {
    const letter = tagName(text, index);
    if (letter >= 0) return text.indexOf('>', letter + 1) >= 0;
  }
  return false;
};

/** The text with each tag (as `containsHtmlTag` reads one, up to the first `>`
 * after its name) replaced, left to right. Once a tag start has no `>` after
 * it, no later one has either, so the rest is kept as written. */
export const replaceHtmlTags = (text: string, replacement: string): string => {
  let output = '';
  let kept = 0;
  let index = text.indexOf('<');
  while (index >= 0) {
    const letter = tagName(text, index);
    if (letter < 0) {
      index = text.indexOf('<', index + 1);
      continue;
    }
    const close = text.indexOf('>', letter + 1);
    if (close < 0) break;
    output += text.slice(kept, index) + replacement;
    kept = close + 1;
    index = text.indexOf('<', kept);
  }
  return output + text.slice(kept);
};

/** Whether the text holds math: a `$` not right after a backslash, and another
 * `$` anywhere after it. The earliest such `$` leaves the most text for the
 * second one, so it alone decides. */
export const containsMath = (text: string): boolean => {
  for (let index = text.indexOf('$'); index >= 0; index = text.indexOf('$', index + 1)) {
    if (index === 0 || text.charCodeAt(index - 1) !== BACKSLASH) return text.indexOf('$', index + 1) >= 0;
  }
  return false;
};

/** Raw HTML/MDX and math need parse5/KaTeX; ordinary Markdown does not. Keep
 * detection conservative—false positives only load the richer renderer, while
 * false negatives could change output. Code (fenced blocks and inline spans)
 * can't hold raw HTML or math, so a `<div>` or `$HOME` in a code sample
 * doesn't count. */
export const needsRichMarkdown = (content: string): boolean => {
  const prose = withoutCode(content);
  return containsHtmlTag(prose) || containsMath(prose);
};

/** A line without its inline code spans: a backtick run that is not preceded by
 * a backslash, at least one character on the same line without a backtick, and a
 * closing run of exactly the same length. Each run is read once: one that opens
 * no span is next read as the following span's possible opener. */
const withoutInlineCode = (line: string): string => {
  if (!line.includes('`')) return line;
  let output = '';
  let kept = 0;
  let index = line.indexOf('`');
  while (index >= 0) {
    let open = index;
    while (line.charCodeAt(open) === BACKTICK) open += 1;
    const length = open - index;
    if (index > 0 && line.charCodeAt(index - 1) === BACKSLASH) {
      index = line.indexOf('`', open);
      continue;
    }
    const close = line.indexOf('`', open);
    if (close < 0) break;
    let end = close;
    while (line.charCodeAt(end) === BACKTICK) end += 1;
    if (close > open && end - close === length) {
      output += line.slice(kept, index);
      kept = end;
      index = line.indexOf('`', end);
    } else index = close;
  }
  return output + line.slice(kept);
};

/** Fenced code lines blanked, as the reader's MDX normalizer sees them
 *  (`fencedMarkdownLines`), and single-line inline code spans. Indented code
 *  blocks and multi-line spans stay, so they can only cause false positives. */
const withoutCode = (content: string): string => {
  if (typeof content !== 'string') return '';
  if (!content.includes('`') && !content.includes('~~~')) return content;
  // A fence inside a blockquote or list ends where its container does, which a
  // line scan can't see: blanking from there could hide math or HTML after it.
  // When unsure, keep everything, so the check errs towards the rich renderer.
  if (CONTAINER_FENCE.test(content)) return content;
  const lines = content.split('\n');
  const fenced = fencedMarkdownLines(lines);
  return lines.map((line, index) => (fenced[index] ? '' : withoutInlineCode(line))).join('\n');
};

/** A fence opened inside a blockquote or list item, at a line start. */
const CONTAINER_FENCE = /^[ \t]*(?:>|[-*+][ \t]|\d{1,9}[.)][ \t])[ \t>]*(?:`{3,}|~{3,})/m;
