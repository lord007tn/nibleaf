import { cn } from '@nibleaf/design-system/lib/utils';
import { Check, Copy } from 'lucide-react';
import { type ComponentProps, lazy, type ReactNode, Suspense, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components, type Options as ReactMarkdownOptions } from 'react-markdown';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import {
  Accordion,
  AccordionGroup,
  Badge,
  Banner,
  Callout,
  Card,
  CardGroup,
  CodeGroup,
  Column,
  Columns,
  Expandable,
  Frame,
  Icon,
  MdxButton,
  ParamField,
  ResponseField,
  Step,
  Steps,
  Tab,
  Tabs,
  Tooltip,
  Update,
} from '@/components/site/mdx-components';
import { normalizeMdxBlocks, rehypeMermaid, remarkCallouts, remarkCodeMeta, sanitizeSchema } from '@/components/site/mdx-config';
import { MermaidBlock } from '@/components/site/mermaid-block';
import { siteT } from '@/lib/site-i18n';
import { siteHref } from '@/lib/site-paths';

/** Link context for a published site: lets the renderer rewrite authored
 *  root-relative doc links (`/guide`) to the site's base path so they don't
 *  break when the site is served under `/sites/:id` (or a custom domain). */
export interface SiteLinkContext {
  projectId: string;
  lang?: string;
  version?: string;
}

export interface MarkdownProps {
  content: string;
  className?: string;
  site?: SiteLinkContext;
}

const RichMarkdown = lazy(() => import('./markdown-rich'));

/** Raw HTML/MDX and math need parse5/KaTeX; ordinary Markdown does not. Keep
 * detection conservative—false positives only load the richer renderer, while
 * false negatives could change output. */
export const needsRichMarkdown = (content: string): boolean => /<\/?[A-Za-z][^>]*>/.test(content) || /(^|[^\\])\$\$?[\s\S]*?\$\$?/m.test(content);

/** Rewrite a root-relative internal doc link to the site base. External URLs,
 *  in-page anchors, mailto/tel, and protocol-relative links are left untouched. */
function resolveDocHref(href: string | undefined, site: SiteLinkContext | undefined): string | undefined {
  if (!href || !site) {
    return href;
  }
  if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || /^([a-z][\w+.-]*:)?\/\//i.test(href)) {
    return href;
  }
  if (href.startsWith('/')) {
    return siteHref(site.projectId, href, { lang: site.lang, version: site.version });
  }
  return href;
}

/** A code block with a one-click copy button (Mintlify-style). When the fence
 *  carries a `title="…"` (lifted onto the child `<code>` by remarkCodeMeta), a
 *  filename header bar is drawn; otherwise the language shows as a floating badge. */
function Pre({ locale, ...props }: ComponentProps<'pre'> & { locale?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const t = siteT(locale);
  // Language + optional title come from the fence meta. mdast→hast may attach
  // them to this <pre> or to the child <code>, so check both.
  const ownProps = props as ComponentProps<'pre'> & { 'data-title'?: string; 'data-lang'?: string };
  const child = props.children as { props?: { className?: string; 'data-title'?: string; 'data-lang'?: string } } | null | undefined;
  const cls = child?.props?.className ?? '';
  const lang = /language-([\w+#-]+)/.exec(cls)?.[1] ?? ownProps['data-lang'] ?? child?.props?.['data-lang'];
  const title = ownProps['data-title'] ?? child?.props?.['data-title'];
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
  const copyButton = (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? t('copied') : t('copyCode')}
      className={cn(
        // [direction:ltr] keeps `end-2` physical-right even inside an RTL page,
        // matching the force-LTR code content (else it collides with the badge).
        'grid size-7 cursor-pointer place-items-center rounded-md text-white/50 transition-colors [direction:ltr] hover:bg-white/10 hover:text-white/90',
        title ? '' : 'absolute end-2 top-2 z-10 opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
      )}
    >
      {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
    </button>
  );
  return (
    // data-not-typeset: this block owns its own chrome (dark panel, header bar,
    // copy button) — typeset must not restyle the <pre> inside. The wrapper's
    // flow margin tracks the configured rhythm.
    <div
      className="group relative mt-(--typeset-flow) overflow-hidden rounded-xl border border-black/20 bg-[#0d1117] shadow-xs dark:border-white/10"
      data-theme-component="code"
      data-not-typeset
    >
      {title ? (
        <div className="flex items-center justify-between gap-3 border-white/[0.08] border-b bg-white/[0.04] px-4 py-2 [direction:ltr]">
          <span className="truncate font-mono text-[12px] text-white/60">{title}</span>
          <div className="flex shrink-0 items-center gap-2">
            {lang ? <span className="font-mono text-[10px] text-white/50 uppercase">{lang}</span> : null}
            {copyButton}
          </div>
        </div>
      ) : (
        <>
          {lang ? (
            <span className="absolute start-3.5 top-2.5 z-10 font-mono text-[11px] text-white/60 uppercase tracking-wide [direction:ltr]">
              {lang}
            </span>
          ) : null}
          {copyButton}
        </>
      )}
      <pre ref={ref} className={cn('overflow-x-auto p-4 text-[13px] leading-relaxed [direction:ltr]', !title && lang && 'pt-9')} {...props} />
    </div>
  );
}

// Base document typography (sizes, spacing, rhythm) is owned by typeset.css —
// the reader-configurable engine driven by --typeset-size/-leading/-flow. Only
// behavioural concerns live here: sticky-header scroll margins, the table
// scroll container, the custom code-block chrome, and image borders. typeset
// uses zero-specificity :where() selectors, so any class added here wins.
// Heading scroll margins track the site chrome's sticky header height via
// --content-scroll-mt (set on the chrome wrapper); the 6rem fallback keeps
// editor preview and changelog offsets sane.
const htmlComponents: Components = {
  h1: (props) => <h1 className="scroll-mt-[var(--content-scroll-mt,6rem)]" {...props} />,
  h2: (props) => <h2 className="scroll-mt-[var(--content-scroll-mt,6rem)]" {...props} />,
  h3: (props) => <h3 className="scroll-mt-[var(--content-scroll-mt,6rem)]" {...props} />,
  h4: (props) => <h4 className="scroll-mt-[var(--content-scroll-mt,6rem)]" {...props} />,
  table: (props) => (
    <div className="typeset-scroll">
      <table {...props} />
    </div>
  ),
  pre: Pre,
  img: (props) => <img className="rounded-xl border border-border" alt={props.alt ?? ''} {...props} />,
};

/** Anchor renderer, built per site-context. Heading self-links (added by
 *  rehype-autolink-headings with the `heading-anchor` class) keep the heading's
 *  own styling — not link color/underline — so headings don't look like broken
 *  hyperlinks. Everything else gets normal link styling and internal doc links
 *  are rewritten to the site base. */
function anchorRenderer(site: SiteLinkContext | undefined) {
  return function Anchor({ className, href, ...props }: ComponentProps<'a'>) {
    const isHeadingAnchor = typeof className === 'string' && className.split(/\s+/).includes('heading-anchor');
    if (isHeadingAnchor) {
      return <a className={cn('font-[inherit] text-inherit no-underline hover:no-underline', className)} href={href} {...props} />;
    }
    return (
      <a
        className={cn('font-medium text-primary underline underline-offset-4 hover:opacity-80', className)}
        href={resolveDocHref(href, site)}
        {...props}
      />
    );
  };
}

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
  icon: ({ icon, name, color, size }) => <Icon icon={str(icon)} name={str(name)} color={str(color)} size={str(size)} />,
  update: ({ label, description, children }) => (
    <Update label={str(label)} description={str(description)}>
      {children}
    </Update>
  ),
  codegroup: ({ children }) => <CodeGroup>{children}</CodeGroup>,
  expandable: ({ title, defaultopen, children }) => (
    <Expandable title={str(title)} defaultOpen={str(defaultopen)}>
      {children}
    </Expandable>
  ),
  paramfield: ({ path, query, header, body, name, type, required, default: def, deprecated, children }) => (
    <ParamField
      path={str(path)}
      query={str(query)}
      header={str(header)}
      body={str(body)}
      name={str(name)}
      type={str(type)}
      required={required}
      default={str(def)}
      deprecated={deprecated}
    >
      {children}
    </ParamField>
  ),
  responsefield: ({ name, type, required, default: def, deprecated, children }) => (
    <ResponseField name={str(name)} type={str(type)} required={required} default={str(def)} deprecated={deprecated}>
      {children}
    </ResponseField>
  ),
  columns: ({ children }) => <Columns>{children}</Columns>,
  column: ({ children }) => <Column>{children}</Column>,
  banner: ({ type, children }) => <Banner type={str(type)}>{children}</Banner>,
  badge: ({ color, children }) => <Badge color={str(color)}>{children}</Badge>,
  button: ({ href, variant, children }) => (
    <MdxButton href={str(href)} variant={str(variant)}>
      {children}
    </MdxButton>
  ),
  mermaid: ({ children }) => <MermaidBlock>{children}</MermaidBlock>,
};

/** Render Markdown + MDX-style components (Cards, Tabs, Steps, Callouts…) with
 *  GFM, admonitions, heading anchors, sanitized raw HTML, and code highlighting.
 *  Pass `site` on a published site so internal links resolve to the site base. */
export function Markdown({ content, className, site }: MarkdownProps) {
  if (needsRichMarkdown(content)) {
    return (
      <Suspense fallback={<MarkdownRenderer content={content} className={className} site={site} />}>
        <RichMarkdown content={content} className={className} site={site} />
      </Suspense>
    );
  }
  return <MarkdownRenderer content={content} className={className} site={site} />;
}

export function MarkdownRenderer({
  content,
  className,
  site,
  extraRemarkPlugins = [],
  extraRehypePlugins = [],
}: MarkdownProps & {
  extraRemarkPlugins?: NonNullable<ReactMarkdownOptions['remarkPlugins']>;
  extraRehypePlugins?: NonNullable<ReactMarkdownOptions['rehypePlugins']>;
}) {
  const components = useMemo(
    () =>
      ({
        ...htmlComponents,
        pre: (props: ComponentProps<'pre'>) => <Pre {...props} locale={site?.lang} />,
        a: anchorRenderer(site),
        ...mdxComponents,
        tabs: ({ children }: MdxProps) => <Tabs language={site?.lang}>{children}</Tabs>,
        accordion: ({ title, defaultopen, children }: MdxProps) => (
          <Accordion title={str(title)} defaultOpen={str(defaultopen)} language={site?.lang}>
            {children}
          </Accordion>
        ),
        codegroup: ({ children }: MdxProps) => <CodeGroup language={site?.lang}>{children}</CodeGroup>,
        expandable: ({ title, defaultopen, children }: MdxProps) => (
          <Expandable title={str(title)} defaultOpen={str(defaultopen)} language={site?.lang}>
            {children}
          </Expandable>
        ),
        paramfield: ({ path, query, header, body, name, type, required, default: def, deprecated, children }: MdxProps) => (
          <ParamField
            path={str(path)}
            query={str(query)}
            header={str(header)}
            body={str(body)}
            name={str(name)}
            type={str(type)}
            required={required}
            default={str(def)}
            deprecated={deprecated}
            language={site?.lang}
          >
            {children}
          </ParamField>
        ),
        responsefield: ({ name, type, required, default: def, deprecated, children }: MdxProps) => (
          <ResponseField name={str(name)} type={str(type)} required={required} default={str(def)} deprecated={deprecated} language={site?.lang}>
            {children}
          </ResponseField>
        ),
        // Card links are internal doc targets too — rewrite them to the site base.
        card: ({ title, href, icon, children }: MdxProps) => (
          <Card title={str(title)} href={resolveDocHref(str(href), site)} icon={str(icon)}>
            {children}
          </Card>
        ),
        button: ({ href, variant, children }: MdxProps) => (
          <MdxButton href={resolveDocHref(str(href), site)} variant={str(variant)}>
            {children}
          </MdxButton>
        ),
      }) as unknown as Components,
    [site],
  );
  return (
    <div className={cn('typeset', className)}>
      <ReactMarkdown
        components={components}
        remarkPlugins={[remarkGfm, ...extraRemarkPlugins, remarkCallouts, remarkCodeMeta]}
        rehypePlugins={[
          ...extraRehypePlugins,
          [rehypeSanitize, sanitizeSchema],
          rehypeMermaid,
          rehypeSlug,
          // `heading-anchor` class lets the anchor renderer keep heading styling
          // (not link color/underline); tabIndex -1 keeps it out of the tab order.
          [rehypeAutolinkHeadings, { behavior: 'wrap', properties: { className: 'heading-anchor', tabIndex: -1 } }],
          rehypeHighlight,
        ]}
      >
        {normalizeMdxBlocks(content)}
      </ReactMarkdown>
    </div>
  );
}
