import type { ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

const components: ComponentProps<typeof ReactMarkdown>['components'] = {
  h1: (props) => <h1 className="mt-2 mb-4 scroll-mt-24 font-semibold text-3xl tracking-tight" {...props} />,
  h2: (props) => <h2 className="mt-10 mb-3 scroll-mt-24 border-border border-b pb-2 font-semibold text-2xl tracking-tight" {...props} />,
  h3: (props) => <h3 className="mt-8 mb-2 scroll-mt-24 font-semibold text-xl tracking-tight" {...props} />,
  h4: (props) => <h4 className="mt-6 mb-2 scroll-mt-24 font-semibold text-lg" {...props} />,
  p: (props) => <p className="my-4 leading-7 text-foreground/90" {...props} />,
  a: (props) => <a className="font-medium text-primary underline underline-offset-4 hover:opacity-80" {...props} />,
  ul: (props) => <ul className="my-4 ms-6 list-disc space-y-2 marker:text-muted-foreground" {...props} />,
  ol: (props) => <ol className="my-4 ms-6 list-decimal space-y-2 marker:text-muted-foreground" {...props} />,
  li: (props) => <li className="leading-7" {...props} />,
  blockquote: (props) => <blockquote className="my-5 border-primary/40 border-s-2 ps-4 text-muted-foreground italic" {...props} />,
  hr: () => <hr className="my-8 border-border" />,
  table: (props) => (
    <div className="my-5 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm" {...props} />
    </div>
  ),
  th: (props) => <th className="border-border border-b bg-muted px-3 py-2 text-start font-medium" {...props} />,
  td: (props) => <td className="border-border border-b px-3 py-2" {...props} />,
  pre: (props) => <pre className="my-5 overflow-x-auto rounded-xl border border-border bg-[#0d1117] p-4 text-sm leading-relaxed" {...props} />,
  code: ({ className, children, ...props }) => {
    const isBlock = typeof className === 'string' && className.includes('language-');
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.85em]" {...props}>
        {children}
      </code>
    );
  },
  img: (props) => <img className="my-5 rounded-xl border border-border" alt={props.alt ?? ''} {...props} />,
};

/** Render Markdown/MDX-ish content with GFM, heading anchors, and code highlighting. */
export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn('text-[15px]', className)}>
      <ReactMarkdown
        components={components}
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug, [rehypeAutolinkHeadings, { behavior: 'wrap' }], rehypeHighlight]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
