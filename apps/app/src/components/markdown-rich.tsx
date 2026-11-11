import 'katex/dist/katex.min.css';
import { useMemo } from 'react';
import type { Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkMath from 'remark-math';
import { readerMdxComponents } from '@/components/site/mdx/component-map';
import { richMarkdownModule } from '@/lib/reader-hydration-modules';
import { type MarkdownProps, MarkdownRenderer } from './markdown';

/** Optional renderer for pages that actually contain raw HTML/MDX or math.
 * Loading it on demand keeps parse5, KaTeX and the MDX component renderers out
 * of ordinary public-doc navigations. Its markup is marked, so the browser loads
 * it before hydrating a page the server rendered with it (see
 * lib/hydration-modules.ts and components/hydration-island.tsx). */
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
      hydrationMarker={richMarkdownModule.marker}
    />
  );
}
