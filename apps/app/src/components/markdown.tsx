import { Check, Copy } from 'lucide-react';
import { type ComponentProps, type ReactNode, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { Accordion, AccordionGroup, Callout, Card, CardGroup, Frame, Step, Steps, Tab, Tabs, Tooltip } from '@/components/site/mdx-components';
import { normalizeMdxBlocks, remarkCallouts, sanitizeSchema } from '@/components/site/mdx-config';
import { cn } from '@/lib/utils';

/** A code block with a one-click copy button (Mintlify-style). */
function Pre(props: ComponentProps<'pre'>) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const text = ref.current?.innerText ?? '';
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };
  return (
    <div className="group relative my-5">
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        className="absolute end-2 top-2 z-10 grid size-7 cursor-pointer place-items-center rounded-md border border-white/15 bg-white/10 text-white/70 opacity-0 transition-opacity hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      <pre
        ref={ref}
        className="overflow-x-auto rounded-xl border border-border bg-[#0d1117] p-4 text-sm leading-relaxed [direction:ltr]"
        {...props}
      />
    </div>
  );
}

const htmlComponents: Components = {
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
  pre: Pre,
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

// MDX component tags. react-markdown's Components type only knows HTML tags, so
// these custom-tag renderers are declared separately and merged with a cast.
type MdxProps = { children?: ReactNode; [key: string]: unknown };
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const mdxComponents: Record<string, (props: MdxProps) => ReactNode> = {
  callout: ({ type, children }) => <Callout type={str(type)}>{children}</Callout>,
  note: ({ children }) => <Callout type="note">{children}</Callout>,
  info: ({ children }) => <Callout type="info">{children}</Callout>,
  tip: ({ children }) => <Callout type="tip">{children}</Callout>,
  check: ({ children }) => <Callout type="check">{children}</Callout>,
  warning: ({ children }) => <Callout type="warning">{children}</Callout>,
  danger: ({ children }) => <Callout type="danger">{children}</Callout>,
  card: ({ title, href, icon, children }) => (
    <Card title={str(title)} href={str(href)} icon={str(icon)}>
      {children}
    </Card>
  ),
  cardgroup: ({ cols, children }) => <CardGroup cols={str(cols)}>{children}</CardGroup>,
  tabs: ({ children }) => <Tabs>{children}</Tabs>,
  tab: ({ title, children }) => <Tab title={str(title)}>{children}</Tab>,
  accordion: ({ title, defaultopen, children }) => (
    <Accordion title={str(title)} defaultOpen={str(defaultopen)}>
      {children}
    </Accordion>
  ),
  accordiongroup: ({ children }) => <AccordionGroup>{children}</AccordionGroup>,
  steps: ({ children }) => <Steps>{children}</Steps>,
  step: ({ title, children }) => <Step title={str(title)}>{children}</Step>,
  mdxframe: ({ caption, children }) => <Frame caption={str(caption)}>{children}</Frame>,
  tooltip: ({ tip, children }) => <Tooltip tip={str(tip)}>{children}</Tooltip>,
};

const components = { ...htmlComponents, ...mdxComponents } as Components;

/** Render Markdown + MDX-style components (Cards, Tabs, Steps, Callouts…) with
 *  GFM, admonitions, heading anchors, sanitized raw HTML, and code highlighting. */
export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn('text-[15px]', className)}>
      <ReactMarkdown
        components={components}
        remarkPlugins={[remarkGfm, remarkCallouts]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeSlug, [rehypeAutolinkHeadings, { behavior: 'wrap' }], rehypeHighlight]}
      >
        {normalizeMdxBlocks(content)}
      </ReactMarkdown>
    </div>
  );
}
