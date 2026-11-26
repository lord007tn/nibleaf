import { type MarkdownCodeUsage, markdownCodeUsage } from './markdown-code-usage';
import { type MarkdownParseBudget, markdownParseBudget } from './page-limits';
import { normalizeMdxBlocks } from './reader-markdown';
import { needsRichMarkdown } from './reader-rich';

/** The article renderer and heading parser use the same mode, read from the
 *  page as the parse budget leaves it (`budget.content`: blocks over budget are
 *  plain-text fences; past the size cap, `budget.whole`, nothing is parsed).
 *  Within the budget, prefer the renderer's Markdown semantics and fall back to
 *  the line scan if code usage cannot parse. */
export const readerRenderMode = (content: string): { rich: boolean; math: boolean; usage: MarkdownCodeUsage | null; budget: MarkdownParseBudget } => {
  const budget = markdownParseBudget(content);
  if (budget.whole) return { rich: false, math: false, usage: null, budget };
  const usage = markdownCodeUsage(normalizeMdxBlocks(budget.content));
  if (usage) return { rich: usage.rich, math: usage.math, usage, budget };
  // Past the parser's bounds no scan can promise to see math as the renderer
  // will (normalization alone can join `ma{/* */}th-inline` into a class), so
  // a rich page gets KaTeX, as every rich page did on main. Such pages are
  // rare (over 400,000 characters or very marker-dense).
  const rich = needsRichMarkdown(budget.content);
  return { rich, math: rich, usage, budget };
};
