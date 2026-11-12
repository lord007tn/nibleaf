import { fencedMarkdownLines } from './markdown-code';

/*
 * Whether a page needs the reader's rich renderer (raw HTML/MDX components or
 * math). The reader's page code imports this, so it stays a line scan with no
 * parser; `readerRenderMode` (./reader-render-mode) refines it with one.
 *
 * Every check here runs on author content up to the page size limit, on the
 * reader's render path, so each is a single linear scan: no regex that could
 * retry from every `<`, `$` or backtick.
 */

const isLetter = (code: number) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const BACKTICK = 96;
const BACKSLASH = 92;

/** A tag: `<`, an optional `/`, a Latin letter, and a `>` somewhere after the
 * letter. The earliest such start leaves the most text for its `>`, so only it
 * needs one look for a `>`. */
const hasTag = (text: string): boolean => {
  for (let index = text.indexOf('<'); index >= 0; index = text.indexOf('<', index + 1)) {
    const letter = text.charCodeAt(index + 1) === 47 ? index + 2 : index + 1;
    if (isLetter(text.charCodeAt(letter))) return text.indexOf('>', letter + 1) >= 0;
  }
  return false;
};

/** Math: a `$` not right after a backslash, and another `$` anywhere after it.
 * The earliest such `$` leaves the most text for the second one. */
const hasMath = (text: string): boolean => {
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
  return hasTag(prose) || hasMath(prose);
};

/** A line without its inline code spans: a backtick run that is not preceded by
 * a backslash, at least one character on the same line without a backtick, and a
 * closing run of exactly the same length. One pass: a run that opens no span is
 * only ever looked at again as the next span's closing candidate. */
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

/** A fence opened inside a blockquote or list item. Anchored at line starts, and
 * each repetition is bounded by the next part's first character class. */
const CONTAINER_FENCE = /^[ \t]*(?:>|[-*+][ \t]|\d{1,9}[.)][ \t])[ \t>]*(?:`{3,}|~{3,})/m;
