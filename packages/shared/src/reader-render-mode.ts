import { type MarkdownCodeUsage, markdownCodeUsage } from './markdown-code-usage';
import { normalizeMdxBlocks } from './reader-markdown';
import { needsRichMarkdown } from './reader-rich';

/** How the reader renders a page: whether with its rich renderer (raw HTML/MDX
 *  and math), whether that also needs KaTeX (math), and the code it holds (null past the parser's safety bounds). Read
 *  with the renderer's own Markdown semantics where those bounds allow, and by the
 *  line scan otherwise. The article renderer and the heading parser
 *  (`./reader-headings`) both decide with it, so they read a page the same way. */
export const readerRenderMode = (content: string): { rich: boolean; math: boolean; usage: MarkdownCodeUsage | null } => {
  const usage = markdownCodeUsage(normalizeMdxBlocks(content));
  if (usage) return { rich: usage.rich, math: usage.math, usage };
  // Past the parser's bounds no scan can promise to see math as the renderer
  // will (normalization alone can join `ma{/* */}th-inline` into a class), so
  // a rich page gets KaTeX, as every rich page did on main. Such pages are
  // rare (over 400,000 characters or very marker-dense).
  const rich = needsRichMarkdown(content);
  return { rich, math: rich, usage };
};
