import type { Attributes } from '@tiptap/core';
import { mergeAttributes, Node } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { MarkdownNodeSpec } from 'tiptap-markdown';
import { TitledBlockView } from './titled-block-view';

/**
 * TipTap nodes for the Mintlify-style MDX components the live site renders
 * (see components/site/mdx-components.tsx). Each authors as a visual block in the
 * WYSIWYG editor and round-trips to its MDX tag in the stored Markdown.
 *
 * Round-trip (paired with `Markdown.configure({ html: true })`):
 *  - serialize → `<Tag attr="…">\n\n …content… \n\n</Tag>` (blank lines so the
 *    Markdown inside the component is parsed as Markdown, not raw text).
 *  - parse → markdown-it (html:true) keeps the raw tags as HTML blocks; the
 *    browser nests them and our `parseHTML` tag matchers rebuild the nodes.
 */

type SerializeState = {
  write: (text: string) => void;
  closeBlock: (node: PMNode) => void;
  renderContent: (node: PMNode) => void;
};

/** Render the MDX attribute string for the configured keys (skips empty values). */
const attrString = (node: PMNode, keys: string[]): string =>
  keys
    .map((key) => {
      const value = node.attrs[key];
      if (value == null || value === '' || value === false) {
        return '';
      }
      if (value === true) {
        return ` ${key}`;
      }
      return ` ${key}="${String(value).replace(/"/g, '&quot;')}"`;
    })
    .join('');

/** A serializer that writes an MDX block tag wrapping its (blank-line-padded) content. */
const mdxBlockSerializer =
  (tag: string, attrKeys: string[]) =>
  (state: SerializeState, node: PMNode): void => {
    state.write(`<${tag}${attrString(node, attrKeys)}>`);
    state.closeBlock(node); // forces a blank line before the inner content
    state.renderContent(node);
    state.write(`</${tag}>`);
    state.closeBlock(node);
  };

const markdownStorage = (tag: string, attrKeys: string[]) => ({
  markdown: { serialize: mdxBlockSerializer(tag, attrKeys), parse: {} } satisfies MarkdownNodeSpec,
});

/** A string attribute that parses from `attr`/`data-attr` and renders to `data-attr`. */
const stringAttr = (name: string): Attributes => ({
  [name]: {
    default: '',
    parseHTML: (element) => element.getAttribute(name) ?? element.getAttribute(`data-${name}`) ?? '',
    renderHTML: (attributes) => (attributes[name] ? { [`data-${name}`]: attributes[name] as string } : {}),
  },
});

/** A boolean attribute (presence / "true"). */
const boolAttr = (name: string): Attributes => ({
  [name]: {
    default: false,
    parseHTML: (element) => element.hasAttribute(name) || element.getAttribute(`data-${name}`) === 'true',
    renderHTML: (attributes) => (attributes[name] ? { [`data-${name}`]: 'true' } : {}),
  },
});

/** A simple wrapper node (no title) holding `content`, e.g. Steps / Tabs / CardGroup. */
const containerNode = (config: { name: string; tag: string; content: string; className: string; attrs?: Attributes; attrKeys?: string[] }) =>
  Node.create({
    name: config.name,
    group: 'block',
    content: config.content,
    defining: true,
    addAttributes: () => config.attrs ?? {},
    parseHTML: () => [{ tag: config.tag.toLowerCase() }, { tag: `div[data-mdx="${config.tag}"]` }],
    renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-mdx': config.tag, class: config.className }), 0],
    addStorage: () => markdownStorage(config.tag, config.attrKeys ?? []),
  });

/** A title-bearing block (Step / Card / Tab / Accordion / Frame): an editable
 *  title input (via the React node view) above an editable body. */
const titledNode = (config: { name: string; tag: string; className: string; attrs?: Attributes; attrKeys: string[] }) =>
  Node.create({
    name: config.name,
    group: 'block',
    content: 'block+',
    defining: true,
    addAttributes: () => config.attrs ?? {},
    parseHTML: () => [{ tag: config.tag.toLowerCase() }, { tag: `div[data-mdx="${config.tag}"]` }],
    renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-mdx': config.tag, class: config.className }), 0],
    addNodeView: () => ReactNodeViewRenderer(TitledBlockView),
    addStorage: () => markdownStorage(config.tag, config.attrKeys),
  });

// ─── Steps ──────────────────────────────────────────────────────────────────
export const Steps = containerNode({ name: 'mdxSteps', tag: 'Steps', content: 'mdxStep+', className: 'pl-steps' });
export const Step = titledNode({ name: 'mdxStep', tag: 'Step', className: 'pl-step', attrs: stringAttr('title'), attrKeys: ['title'] });

// ─── Cards ──────────────────────────────────────────────────────────────────
export const CardGroup = containerNode({
  name: 'mdxCardGroup',
  tag: 'CardGroup',
  content: 'mdxCard+',
  className: 'pl-cardgroup',
  attrs: {
    cols: {
      default: '2',
      parseHTML: (el) => el.getAttribute('cols') ?? el.getAttribute('data-cols') ?? '2',
      renderHTML: (a) => ({ 'data-cols': String(a.cols ?? '2') }),
    },
  },
  attrKeys: ['cols'],
});
export const Card = titledNode({
  name: 'mdxCard',
  tag: 'Card',
  className: 'pl-card',
  attrs: { ...stringAttr('title'), ...stringAttr('icon'), ...stringAttr('href') },
  attrKeys: ['title', 'icon', 'href'],
});

// ─── Tabs ───────────────────────────────────────────────────────────────────
export const Tabs = containerNode({ name: 'mdxTabs', tag: 'Tabs', content: 'mdxTab+', className: 'pl-tabs' });
export const Tab = titledNode({ name: 'mdxTab', tag: 'Tab', className: 'pl-tab', attrs: stringAttr('title'), attrKeys: ['title'] });

// ─── Accordions ─────────────────────────────────────────────────────────────
export const AccordionGroup = containerNode({
  name: 'mdxAccordionGroup',
  tag: 'AccordionGroup',
  content: 'mdxAccordion+',
  className: 'pl-accordiongroup',
});
export const Accordion = titledNode({
  name: 'mdxAccordion',
  tag: 'Accordion',
  className: 'pl-accordion',
  attrs: { ...stringAttr('title'), ...boolAttr('defaultOpen') },
  attrKeys: ['title', 'defaultOpen'],
});

// ─── Frame ──────────────────────────────────────────────────────────────────
export const Frame = titledNode({ name: 'mdxFrame', tag: 'Frame', className: 'pl-frame', attrs: stringAttr('caption'), attrKeys: ['caption'] });

/** All MDX component nodes, for the editor's extension list. */
export const mdxNodes = [Steps, Step, CardGroup, Card, Tabs, Tab, AccordionGroup, Accordion, Frame];
