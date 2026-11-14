import 'katex/dist/katex.min.css';
import type { Options as ReactMarkdownOptions } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';

/** Math for the rich renderer (KaTeX, its stylesheet, and the Markdown math
 *  syntax): only pages with `$…$` math outside code load it (PUB-017). Before,
 *  every page with an MDX component or raw HTML carried KaTeX, math or not. */
export interface MathPlugins {
  remark: NonNullable<ReactMarkdownOptions['remarkPlugins']>;
  afterSanitize: NonNullable<ReactMarkdownOptions['rehypePlugins']>;
}

export const mathPlugins: MathPlugins = {
  remark: [remarkMath],
  afterSanitize: [[rehypeKatex, { trust: false }]],
};
