import { type MarkdownCodeUsage, markdownCodeUsage } from './markdown-code-usage';
import { normalizeMdxBlocks } from './reader-markdown';
import { needsMathMarkdown, needsRichMarkdown } from './reader-rich';

/** How the reader renders a page: whether with its rich renderer (raw HTML/MDX
 *  and math), whether that also needs KaTeX (math), and the code it holds (null past the parser's safety bounds). Read
 *  with the renderer's own Markdown semantics where those bounds allow, and by the
 *  line scan otherwise. The article renderer and the heading parser
 *  (`./reader-headings`) both decide with it, so they read a page the same way. */
export const readerRenderMode = (content: string): { rich: boolean; math: boolean; usage: MarkdownCodeUsage | null } => {
  const usage = markdownCodeUsage(normalizeMdxBlocks(content));
  return usage ? { rich: usage.rich, math: usage.math, usage } : { rich: needsRichMarkdown(content), math: needsMathMarkdown(content), usage };
};
