import 'katex/dist/katex.min.css';
import { DOCUMENTATION_COMPONENT_CONTRACT } from '@nibleaf/shared/documentation-component-contract';
import { literalJsxAttributesToHtml } from '@nibleaf/shared/mdx-attributes';
import { useMemo } from 'react';
import type { Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkMath from 'remark-math';
import { readerMdxComponents } from '@/components/site/mdx/component-map';
import { type MarkdownProps, MarkdownRenderer } from './markdown';

const isComponentTag = (tag: string): boolean => Object.hasOwn(DOCUMENTATION_COMPONENT_CONTRACT, tag);

/** Optional renderer for pages that actually contain raw HTML/MDX or math.
 * React.lazy keeps parse5, KaTeX and the MDX component renderers out of
 * ordinary public-doc navigations; React's streaming SSR still resolves this
 * component before sending its final content, preserving indexable markup and
 * hydration identity. */
export default function RichMarkdown(props: MarkdownProps) {
  const { site, content } = props;
  const mdxComponents = useMemo(() => readerMdxComponents(site) as Components, [site]);
  // Part of the reader's pre-parse, just before normalizeMdxBlocks: Mintlify's
  // literal JSX props (`cols={3}`, `tags={["Fix"]}`) become plain HTML
  // attributes. It runs here, not in normalizeMdxBlocks, because only pages
  // with authored tags (which always load this chunk) can contain them.
  const htmlContent = useMemo(() => literalJsxAttributesToHtml(content, isComponentTag), [content]);
  return (
    <MarkdownRenderer
      {...props}
      content={htmlContent}
      mdxComponents={mdxComponents}
      extraRemarkPlugins={[remarkMath]}
      extraRehypePlugins={[rehypeRaw]}
      afterSanitizePlugins={[[rehypeKatex, { trust: false }]]}
    />
  );
}
