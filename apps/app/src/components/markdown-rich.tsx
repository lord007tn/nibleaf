import 'katex/dist/katex.min.css';
import { useMemo } from 'react';
import type { Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkMath from 'remark-math';
import { readerMdxComponents } from '@/components/site/mdx/component-map';
import { type MarkdownProps, MarkdownRenderer } from './markdown';

/** Optional renderer for pages that actually contain raw HTML/MDX or math.
 * Loading it on demand keeps parse5, KaTeX and the MDX component renderers out
 * of ordinary public-doc navigations; see `richMarkdownModule` for how it loads
 * before hydration. */
export default function RichMarkdown(props: MarkdownProps) {
  const { site } = props;
  const mdxComponents = useMemo(() => readerMdxComponents(site) as Components, [site]);
  return (
    <MarkdownRenderer
      {...props}
      mdxComponents={mdxComponents}
      extraRemarkPlugins={[remarkMath]}
      extraRehypePlugins={[rehypeRaw]}
      afterSanitizePlugins={[[rehypeKatex, { trust: false }]]}
    />
  );
}
