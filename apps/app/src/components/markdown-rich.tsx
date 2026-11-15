import { useMemo } from 'react';
import type { Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { readerMdxComponents } from '@/components/site/mdx/component-map';
import { ReaderSource, ReaderTrack, ReaderVideo, VideoEmbed } from '@/components/site/mdx/video-embed';
import { type MarkdownProps, MarkdownRenderer } from './markdown';
import type { MathPlugins } from './markdown-math';

type EmbedProps = { provider?: string; videoid?: string; start?: string | number; title?: string; href?: string; text?: string };

/** Optional renderer for pages that actually contain raw HTML/MDX or math.
 * Loading it on demand keeps parse5 and the MDX component renderers out of
 * ordinary public-doc navigations; see `richMarkdownModule` for how it loads
 * before hydration. KaTeX comes separately, only for pages with math (`math`,
 * from `mathMarkdownModule`). */
export default function RichMarkdown({ math, ...props }: MarkdownProps & { math?: MathPlugins }) {
  const { site } = props;
  const mdxComponents = useMemo(
    () =>
      ({
        ...readerMdxComponents(site),
        // Authored iframes and videos (see @nibleaf/shared/reader-embeds); not registry components.
        mdxembed: ({ provider, videoid, start, title, href, text }: EmbedProps) => (
          <VideoEmbed provider={provider} videoid={videoid} start={start} title={title} href={href} text={text} language={site?.lang} />
        ),
        video: ReaderVideo,
        source: ReaderSource,
        track: ReaderTrack,
      }) as Components,
    [site],
  );
  return (
    <MarkdownRenderer
      {...props}
      mdxComponents={mdxComponents}
      extraRemarkPlugins={math?.remark ?? []}
      extraRehypePlugins={[rehypeRaw]}
      afterSanitizePlugins={math?.afterSanitize ?? []}
    />
  );
}
