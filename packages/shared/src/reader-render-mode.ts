import { type MarkdownCodeUsage, markdownCodeUsage } from './markdown-code-usage';
import { type MarkdownParseLimit, markdownParseLimit } from './page-limits';
import { normalizeMdxBlocks } from './reader-markdown';
import { needsRichMarkdown } from './reader-rich';

/** The article renderer and heading parser use the same mode. Over-budget
 *  sources render as plain text. Within the budget, prefer the renderer's
 *  Markdown semantics and fall back to the line scan if code usage cannot parse. */
export const readerRenderMode = (
  content: string,
): { rich: boolean; math: boolean; usage: MarkdownCodeUsage | null; parseLimit?: MarkdownParseLimit } => {
  const parseLimit = markdownParseLimit(content);
  if (parseLimit) return { rich: false, math: false, usage: null, parseLimit };
  const usage = markdownCodeUsage(normalizeMdxBlocks(content));
  if (usage) return { rich: usage.rich, math: usage.math, usage };
  // Past the parser's bounds no scan can promise to see math as the renderer
  // will (normalization alone can join `ma{/* */}th-inline` into a class), so
  // a rich page gets KaTeX, as every rich page did on main. Such pages are
  // rare (over 400,000 characters or very marker-dense).
  const rich = needsRichMarkdown(content);
  return { rich, math: rich, usage };
};
