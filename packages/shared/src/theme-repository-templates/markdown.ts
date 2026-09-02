/** `src/lib/markdown.tsx`: runtime Markdown rendering. Content is never
 * compiled to code; MDX component tags pass through rehype-raw and an explicit
 * sanitize allow-list before React renders them (same contract as Nibleaf). */
export const markdownTemplate =
  (): string => String.raw`import { Children, type ComponentPropsWithoutRef, createElement, isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { mdxComponents } from '../components/mdx';
import { uniqueHeadingId } from './site';

const componentTags = [
  'callout', 'note', 'info', 'tip', 'check', 'warning', 'danger', 'card', 'cardgroup', 'tabs', 'tab', 'accordion', 'accordiongroup',
  'steps', 'step', 'mdxframe', 'tooltip', 'icon', 'paramfield', 'responsefield', 'expandable', 'codegroup', 'update', 'columns', 'column',
  'banner', 'badge', 'button', 'filetree', 'folder', 'file', 'apiexample', 'requestexample', 'responseexample', 'relatedcontent', 'relatedcard',
];

/** Allow-list for authored HTML/MDX. Everything outside it is stripped. */
export const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), ...componentTags],
  attributes: {
    ...defaultSchema.attributes,
    card: ['title', 'href', 'icon'],
    cardgroup: ['cols'],
    callout: ['type'],
    tab: ['title'],
    accordion: ['title', 'defaultOpen', 'defaultopen'],
    step: ['title'],
    mdxframe: ['caption'],
    tooltip: ['tip'],
    icon: ['icon', 'dataDisplayName', 'color', 'size'],
    paramfield: ['path', 'query', 'header', 'body', 'name', 'type', 'required', 'default', 'deprecated'],
    responsefield: ['name', 'type', 'required', 'default', 'deprecated'],
    expandable: ['title', 'defaultOpen', 'defaultopen'],
    update: ['label', 'description'],
    banner: ['type'],
    badge: ['color'],
    button: ['href', 'variant'],
    folder: ['dataDisplayName', 'defaultOpen', 'defaultopen'],
    file: ['dataDisplayName', 'icon'],
    apiexample: ['title'],
    requestexample: ['title'],
    responseexample: ['title', 'status'],
    relatedcontent: ['title'],
    relatedcard: ['title', 'description', 'href', 'icon'],
  },
};

const blockTags =
  'Callout|Note|Warning|Info|Tip|Check|Danger|Card|CardGroup|Tabs|Tab|Accordion|AccordionGroup|Steps|Step|Frame|ParamField|ResponseField|Expandable|Update|Columns|Column|Banner|FileTree|Folder|File|ApiExample|RequestExample|ResponseExample|RelatedContent|RelatedCard';
const openBlock = new RegExp('^\\s*<(?:' + blockTags + ')\\b(?:[^>]*[^/>])?>\\s*$', 'i');
const closeBlock = new RegExp('^\\s*</(?:' + blockTags + ')>\\s*$', 'i');
const componentLine = new RegExp('^\\s*</?(?:' + blockTags + ')\\b[^>]*>\\s*$', 'i');

/** Give component tags the blank lines CommonMark needs so their Markdown
 * children still render, and map tags that collide with HTML names. */
export const normalizeMarkdown = (source: string): string => {
  const lines = source.split('\n');
  const output: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const authored = lines[index] ?? '';
    const line = componentLine.test(authored) ? authored.trim() : authored;
    if (openBlock.test(line)) {
      output.push(line);
      if (lines[index + 1]?.trim()) output.push('');
    } else if (closeBlock.test(line)) {
      if (output.at(-1)?.trim()) output.push('');
      output.push(line);
    } else {
      output.push(line);
    }
  }
  return output
    .join('\n')
    .replace(/<(\/?)Frame\b/gi, '<$1mdxframe')
    .replace(/<(File|RelatedCard|Icon)\b([^>]*)\/>/gi, '<$1$2></$1>');
};

type HastNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };
const authoredNameTags = new Set(['folder', 'file', 'paramfield', 'responsefield', 'icon']);
const structuralTags = new Set(['card', 'tab', 'accordion', 'step', 'column', 'folder', 'file', 'requestexample', 'responseexample', 'relatedcard']);

/** Keep authored "name" attributes (HTML would drop them) and unwrap the
 * paragraphs Markdown places around structural component children. */
export const rehypeAuthoredComponentProps = () => (tree: HastNode): void => {
  const visit = (node: HastNode): void => {
    if (node.type === 'element' && node.tagName && authoredNameTags.has(node.tagName) && node.properties?.name !== undefined) {
      node.properties.dataDisplayName = node.properties.name;
      delete node.properties.name;
    }
    if (node.children) {
      node.children = node.children.flatMap((child) => {
        if (
          child.type === 'element' &&
          child.tagName === 'p' &&
          child.children?.every((nested) => (nested.type === 'text' ? !nested.value?.trim() : Boolean(nested.tagName && structuralTags.has(nested.tagName))))
        ) {
          return child.children;
        }
        return [child];
      });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
};

const textOf = (children: ReactNode): string =>
  Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      return isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : '';
    })
    .join('');

type HeadingProps = ComponentPropsWithoutRef<'h2'> & { node?: unknown };

export function Markdown({ body }: { body: string }) {
  // Heading ids are assigned in document order with the same rule the page
  // outline uses, so anchors and the table of contents always agree.
  const used = new Map<string, number>();
  const heading = (tag: 'h2' | 'h3') =>
    function Heading({ children, node: _node, ...props }: HeadingProps) {
      const id = uniqueHeadingId(textOf(children), used);
      return createElement(tag, { ...props, id }, createElement('a', { href: '#' + id }, children));
    };
  const components: Components = { ...mdxComponents, h2: heading('h2'), h3: heading('h3') };
  return (
    <ReactMarkdown
      components={components}
      rehypePlugins={[rehypeRaw, rehypeAuthoredComponentProps, [rehypeSanitize, sanitizeSchema]]}
      remarkPlugins={[remarkGfm]}
    >
      {normalizeMarkdown(body)}
    </ReactMarkdown>
  );
}
`;

export const markdownTestTemplate = (): string => String.raw`import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown, normalizeMarkdown } from './markdown';

describe('Markdown renderer', () => {
  it('renders Nibleaf components through the sanitize allow-list', () => {
    const html = renderToStaticMarkup(
      <Markdown
        body={
          '## Overview\n\nA <Tooltip tip="Auth token">credential</Tooltip> and <Icon icon="star" />.\n\n<Callout type="tip">\n\n**Portable callout**\n\n</Callout>\n\n<FileTree>\n  <Folder name="src" defaultOpen>\n    <File name="client.ts" />\n  </Folder>\n</FileTree>\n\n<script>alert(1)</script>'
        }
      />,
    );
    expect(html).toContain('id="overview"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('aria-describedby=');
    expect(html).toContain('aria-label="star"');
    expect(html).toContain('mdx-callout-tip');
    expect(html).toContain('<strong>Portable callout</strong>');
    expect(html).toContain('<ul class="mdx-file-tree" dir="ltr">');
    expect(html).toContain('client.ts');
    expect(html).not.toContain('<script');
  });

  it('keeps duplicate headings addressable', () => {
    const html = renderToStaticMarkup(<Markdown body={'## Setup\n\ntext\n\n## Setup'} />);
    expect(html).toContain('id="setup"');
    expect(html).toContain('id="setup-1"');
  });

  it('adds the blank lines block components need', () => {
    expect(normalizeMarkdown('<Callout>\n**Bold**\n</Callout>')).toBe('<Callout>\n\n**Bold**\n\n</Callout>');
  });
});
`;
