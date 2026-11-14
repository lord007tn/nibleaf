import { cn } from '@nibleaf/design-system/lib/utils';
import { rehypeReaderHeadingIds } from '@nibleaf/shared/reader-heading-ids';
import { readerRenderMode } from '@nibleaf/shared/reader-render-mode';
import type { LanguageFn } from 'highlight.js';
import { Children, type ComponentProps, cloneElement, isValidElement, Suspense, useMemo } from 'react';
import ReactMarkdown, { type Components, type Options as ReactMarkdownOptions } from 'react-markdown';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { rehypeImageLoading } from '@/components/site/image-loading';
import { Callout } from '@/components/site/mdx/callout';
import { type DocumentationComponents, str } from '@/components/site/mdx/props';
import {
  normalizeMdxBlocks,
  rehypeAuthoredComponentProps,
  rehypeBlockDirection,
  rehypeMermaid,
  remarkCallouts,
  remarkCodeMeta,
  sanitizeSchema,
} from '@/components/site/mdx-config';
import { MermaidBlock } from '@/components/site/mermaid-block';
import { Pre } from '@/components/site/reader-code-block';
import { ContentImage, SectionLink } from '@/components/site/reader-content-controls';
import { CORE_HIGHLIGHT_GRAMMARS, rehypeReaderHighlight } from '@/components/site/reader-highlight';
import { lazyHighlightLanguages, lazyHighlightLanguagesNamed } from '@/lib/highlight-languages';
import { HYDRATION_MODULE_ATTRIBUTE, HydrationIsland } from '@/lib/hydration-modules';
import { highlightLanguageModule, richMarkdownModule } from '@/lib/reader-hydration-modules';
import { siteHref, siteLanguageParam } from '@/lib/site-paths';

/** Link context for a published site: lets the renderer rewrite authored
 *  root-relative doc links (`/guide`) to the site's base path so they don't
 *  break when the site is served under `/sites/:id` (or a custom domain). */
export interface SiteLinkContext {
  projectId: string;
  lang?: string;
  defaultLanguage?: string;
  version?: string;
}

export interface MarkdownProps {
  content: string;
  className?: string;
  site?: SiteLinkContext;
  /** Grammars beyond the core set, loaded for this content (see `Markdown`). */
  highlightGrammars?: Readonly<Record<string, LanguageFn>>;
}

/** The rich renderer's chunk (see richMarkdownModule). */
export const loadRichMarkdown = () => import('./markdown-rich').then((module) => module.default);

const RICH_MODULES = [richMarkdownModule];

/** Rewrite a root-relative internal doc link to the site base. External URLs,
 *  in-page anchors, mailto/tel, and protocol-relative links are left untouched. */
export function resolveDocHref(href: string | undefined, site: SiteLinkContext | undefined): string | undefined {
  if (!href || !site) {
    return href;
  }
  if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || /^([a-z][\w+.-]*:)?\/\//i.test(href)) {
    return href;
  }
  if (href.startsWith('/')) {
    return siteHref(site.projectId, href, { lang: siteLanguageParam(site.lang, site.defaultLanguage), version: site.version });
  }
  return href;
}

// Base document typography (sizes, spacing, rhythm) is owned by typeset.css —
// the reader-configurable engine driven by --typeset-size/-leading/-flow, with
// tables, code blocks and task lists in content-blocks.css, shared with the
// editor. Only behavioural concerns live here: sticky-header scroll margins,
// the table scroll container, the code-block controls, and image borders. typeset
// uses zero-specificity :where() selectors, so any class added here wins.
// Heading scroll margins track the site chrome's sticky header height via
// --content-scroll-mt (set on the chrome wrapper); the 6rem fallback keeps
// editor preview and changelog offsets sane.
// react-markdown passes its hast `node` to custom components; it must not reach
// the DOM (it would render as `node="[object Object]"`).
const htmlComponents: Components = {
  h1: ({ node: _node, ...props }) => <h1 className="scroll-mt-[var(--content-scroll-mt,6rem)]" {...props} />,
  h2: ({ node: _node, ...props }) => <h2 className="scroll-mt-[var(--content-scroll-mt,6rem)]" {...props} />,
  h3: ({ node: _node, ...props }) => <h3 className="scroll-mt-[var(--content-scroll-mt,6rem)]" {...props} />,
  h4: ({ node: _node, ...props }) => <h4 className="scroll-mt-[var(--content-scroll-mt,6rem)]" {...props} />,
  table: ({ node: _node, ...props }) => (
    <div className="typeset-scroll">
      <table {...props} />
    </div>
  ),
  pre: Pre,
  li: TaskListItem,
  // Authored classes (light/dark image pairs) add to the default frame, and an
  // image without alt text is marked decorative instead of losing the attribute.
  img: ({ node: _node, ...props }) => <img {...props} alt={props.alt ?? ''} className={cn('rounded-xl border border-border', props.className)} />,
};

/** Text of a hast node, without nested lists (a sub-task names its own box). */
function itemText(node: { type: string; value?: string; tagName?: string; children?: unknown[] } | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  if (node.tagName === 'ul' || node.tagName === 'ol' || node.tagName === 'input') return '';
  return ((node.children ?? []) as (typeof node)[]).map(itemText).join('');
}

/** GFM task items: the read-only checkbox is named by the item's text, so a
 *  screen reader says "Sandbox shipment booked, checkbox, checked" rather than
 *  an unnamed checkbox (P3-PUB-025; axe `label`). Other items pass through. */
function TaskListItem({ node, children, ...props }: ComponentProps<'li'> & { node?: { children?: unknown[] } }) {
  if (!props.className?.split(/\s+/).includes('task-list-item')) return <li {...props}>{children}</li>;
  const label = itemText(node as Parameters<typeof itemText>[0])
    .replace(/\s+/g, ' ')
    .trim();
  return (
    <li {...props}>
      {Children.map(children, (child) =>
        isValidElement<ComponentProps<'input'>>(child) && child.props.type === 'checkbox'
          ? cloneElement(child, { 'aria-label': label || undefined })
          : child,
      )}
    </li>
  );
}

/** Anchor renderer, built per site-context. Heading self-links (added by
 *  rehype-autolink-headings with the `heading-anchor` class) keep the heading's
 *  own styling — not link color/underline — so headings don't look like broken
 *  hyperlinks. Everything else gets normal link styling and internal doc links
 *  are rewritten to the site base. */
function anchorRenderer(site: SiteLinkContext | undefined) {
  return function Anchor({ className, href, node: _node, ...props }: ComponentProps<'a'> & { node?: unknown }) {
    const isHeadingAnchor = className?.split(/\s+/).includes('heading-anchor');
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

/** The only component elements reachable without raw HTML: `callout` from
 *  `> [!NOTE]` admonitions (remarkCallouts) and `mermaid` from ```mermaid fences
 *  (rehypeMermaid). Every authored component tag needs raw HTML, so its renderer
 *  ships with the lazy rich renderer (see site/mdx/component-map.tsx). */
export const baseMdxComponents: Pick<DocumentationComponents, 'callout' | 'mermaid'> = {
  callout: ({ type, dir, children }) => (
    <Callout type={str(type)} dir={str(dir)}>
      {children}
    </Callout>
  ),
  mermaid: ({ children }) => <MermaidBlock>{children}</MermaidBlock>,
};

/** Render Markdown + MDX-style components (Cards, Tabs, Steps, Callouts…) with
 *  GFM, admonitions, heading anchors, sanitized raw HTML, and code highlighting.
 *  Pass `site` on a published site so internal links resolve to the site base. */
export function Markdown(props: MarkdownProps) {
  // Read with the renderer's own Markdown semantics (nested fences, container
  // ends, `r&#117;st`), the same on the server and in the browser, so the
  // modules the server marked are the ones hydration expects. Past the parser's
  // safety bounds, the line-based checks decide, erring towards loading.
  const { rich, usage } = readerRenderMode(props.content);
  const languages = usage ? lazyHighlightLanguagesNamed(usage.languages, props.content) : lazyHighlightLanguages(props.content);
  if (languages.length === 0) return <MarkdownBody {...props} rich={rich} />;
  // Code in a language outside the core grammars: its grammars load like the
  // rich renderer (before hydrating, and in the reader's loaders), and until
  // they have, the plain body keeps those blocks readable, unhighlighted.
  const modules = languages.map(highlightLanguageModule);
  const plain = <MarkdownBody {...props} rich={rich} />;
  const marker = { [HYDRATION_MODULE_ATTRIBUTE]: modules.map((module) => module.key).join(' ') };
  return (
    <Suspense fallback={plain}>
      <HydrationIsland className="contents" {...marker} modules={modules} pending={plain} failed={() => plain}>
        {() => <MarkdownBody {...props} rich={rich} highlightGrammars={Object.assign({}, ...modules.map((module) => module.read()))} />}
      </HydrationIsland>
    </Suspense>
  );
}

function MarkdownBody({ content, className, site, highlightGrammars, rich }: MarkdownProps & { rich: boolean }) {
  if (rich) {
    // The router loads the rich chunk before hydrating markup it rendered, and
    // the reader's loaders before navigating. Until it loads, hydrating keeps
    // the server's markup and a client render shows the plain renderer, which
    // keeps the text readable; so does a chunk that never loads. Only the
    // server render suspends, waiting for the chunk.
    const plain = <MarkdownRenderer content={content} className={className} site={site} highlightGrammars={highlightGrammars} />;
    return (
      <Suspense fallback={plain}>
        <HydrationIsland className="contents" {...richMarkdownModule.marker} modules={RICH_MODULES} pending={plain} failed={() => plain}>
          {() => {
            const Rich = richMarkdownModule.read();
            return <Rich content={content} className={className} site={site} highlightGrammars={highlightGrammars} />;
          }}
        </HydrationIsland>
      </Suspense>
    );
  }
  return <MarkdownRenderer content={content} className={className} site={site} highlightGrammars={highlightGrammars} />;
}

export function MarkdownRenderer({
  content,
  className,
  site,
  highlightGrammars,
  extraRemarkPlugins = [],
  extraRehypePlugins = [],
  afterSanitizePlugins = [],
  mdxComponents,
}: MarkdownProps & {
  extraRemarkPlugins?: NonNullable<ReactMarkdownOptions['remarkPlugins']>;
  extraRehypePlugins?: NonNullable<ReactMarkdownOptions['rehypePlugins']>;
  /** Internal trusted renderers only: authored HTML must be sanitized first. */
  afterSanitizePlugins?: NonNullable<ReactMarkdownOptions['rehypePlugins']>;
  /** Renderers for authored component tags, supplied by the rich renderer. */
  mdxComponents?: Components;
}) {
  const components = useMemo(() => {
    const mergedComponents: Components = {
      ...htmlComponents,
      ...(site
        ? ({
            h2: ({ node: _node, ...props }) => (
              <div className="reader-heading">
                <h2 className="scroll-mt-[var(--content-scroll-mt,6rem)]" {...props} />
                {props.id && <SectionLink id={props.id} language={site.lang} />}
              </div>
            ),
            h3: ({ node: _node, ...props }) => (
              <div className="reader-heading">
                <h3 className="scroll-mt-[var(--content-scroll-mt,6rem)]" {...props} />
                {props.id && <SectionLink id={props.id} language={site.lang} />}
              </div>
            ),
            h4: ({ node: _node, ...props }) => (
              <div className="reader-heading">
                <h4 className="scroll-mt-[var(--content-scroll-mt,6rem)]" {...props} />
                {props.id && <SectionLink id={props.id} language={site.lang} />}
              </div>
            ),
            // Authored classes (e.g. light/dark image pairs) must keep winning over the default frame.
            img: ({ node: _node, ...props }) => (
              <ContentImage {...props} className={cn('rounded-xl border border-border', props.className)} language={site.lang} />
            ),
          } satisfies Components)
        : {}),
      pre: (props: ComponentProps<'pre'>) => <Pre {...props} locale={site?.lang} />,
      a: anchorRenderer(site),
      ...baseMdxComponents,
      ...mdxComponents,
    };
    return mergedComponents;
  }, [site, mdxComponents]);
  return (
    // nibleaf-content: the tables, code blocks and task lists styled the same
    // in the editor (content-blocks.css).
    <div className={cn('typeset nibleaf-content', className)}>
      <ReactMarkdown
        components={components}
        remarkPlugins={[remarkGfm, ...extraRemarkPlugins, remarkCallouts, remarkCodeMeta]}
        rehypePlugins={[
          ...extraRehypePlugins,
          rehypeAuthoredComponentProps,
          // Before the sanitizer: it reads authored sizes and light/dark classes
          // to pick the image that loads at once; the rest load as the reader scrolls.
          rehypeImageLoading,
          [rehypeSanitize, sanitizeSchema],
          ...afterSanitizePlugins,
          rehypeMermaid,
          // Each block lays out by its own script; code stays left to right.
          rehypeBlockDirection,
          // The reader's heading ids, the same ones the search indexer records and
          // the chat's citations are checked against (@nibleaf/shared/reader-headings).
          rehypeReaderHeadingIds,
          // `heading-anchor` class lets the anchor renderer keep heading styling
          // (not link color/underline); tabIndex -1 keeps it out of the tab order.
          [rehypeAutolinkHeadings, { behavior: 'wrap', properties: { className: 'heading-anchor', tabIndex: -1 } }],
          [rehypeReaderHighlight, { grammars: highlightGrammars ? { ...CORE_HIGHLIGHT_GRAMMARS, ...highlightGrammars } : CORE_HIGHLIGHT_GRAMMARS }],
        ]}
      >
        {normalizeMdxBlocks(content)}
      </ReactMarkdown>
    </div>
  );
}
