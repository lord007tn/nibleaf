import { fencedMarkdownLines } from './markdown-code';

/*
 * Whether a page needs the reader's rich renderer (raw HTML/MDX components or
 * math). The reader's page code imports this, so it stays a line scan with no
 * parser; `readerRendersRich` (./reader-render-mode) refines it with one.
 */

/** Raw HTML/MDX and math need parse5/KaTeX; ordinary Markdown does not. Keep
 * detection conservative—false positives only load the richer renderer, while
 * false negatives could change output. Code (fenced blocks and inline spans)
 * can't hold raw HTML or math, so a `<div>` or `$HOME` in a code sample
 * doesn't count. */
export const needsRichMarkdown = (content: string): boolean => {
  const prose = withoutCode(content);
  return /<\/?[A-Za-z][^>]*>/.test(prose) || /(^|[^\\])\$\$?[\s\S]*?\$\$?/m.test(prose);
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
  return lines.map((line, index) => (fenced[index] ? '' : line.replace(INLINE_CODE, ''))).join('\n');
};

/** A backtick run that isn't escaped, its text on the same line, and a closing
 *  run of the same length. */
const INLINE_CODE = /(?<![\\`])(`+)[^`\n]+?\1(?!`)/g;
/** A fence opened inside a blockquote or list item. */
const CONTAINER_FENCE = /^[ \t]*(?:>|[-*+][ \t]|\d{1,9}[.)][ \t])[ \t>]*(?:`{3,}|~{3,})/m;
