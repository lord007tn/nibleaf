import 'katex/dist/katex.min.css';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkMath from 'remark-math';
import { type MarkdownProps, MarkdownRenderer } from './markdown';

/** Optional renderer for pages that actually contain raw HTML/MDX or math.
 * React.lazy keeps parse5 and KaTeX out of ordinary public-doc navigations;
 * React's streaming SSR still resolves this component before sending its final
 * content, preserving indexable markup and hydration identity. */
export default function RichMarkdown(props: MarkdownProps) {
  return <MarkdownRenderer {...props} extraRemarkPlugins={[remarkMath]} extraRehypePlugins={[rehypeRaw, rehypeKatex]} />;
}
