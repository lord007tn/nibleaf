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
  renderInline: (node: PMNode) => void;
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

/** Merge several string attributes by name. */
const stringAttrs = (...names: string[]): Attributes => Object.assign({}, ...names.map(stringAttr));

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

const inlineWrapperNode = (config: { name: string; tag: string; className: string; attrs?: Attributes; attrKeys: string[] }) =>
  Node.create({
    name: config.name,
    group: 'inline',
    inline: true,
    content: 'inline*',
    addAttributes: () => config.attrs ?? {},
    parseHTML: () => [{ tag: config.tag.toLowerCase() }, { tag: `span[data-mdx="${config.tag}"]` }],
    renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-mdx': config.tag, class: config.className }), 0],
    addStorage: () => ({
      markdown: {
        serialize: (state: SerializeState, node: PMNode) => {
          state.write(`<${config.tag}${attrString(node, config.attrKeys)}>`);
          state.renderInline(node);
          state.write(`</${config.tag}>`);
        },
        parse: {},
      } satisfies MarkdownNodeSpec,
    }),
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

// ─── Expandable (collapsible disclosure) ──────────────────────────────────────
export const Expandable = titledNode({
  name: 'mdxExpandable',
  tag: 'Expandable',
  className: 'pl-expandable',
  attrs: { ...stringAttr('title'), ...boolAttr('defaultOpen') },
  attrKeys: ['title', 'defaultOpen'],
});

// ─── Update (changelog entry) ─────────────────────────────────────────────────
export const Update = containerNode({
  name: 'mdxUpdate',
  tag: 'Update',
  content: 'block+',
  className: 'pl-update',
  attrs: { ...stringAttr('label'), ...stringAttr('description') },
  attrKeys: ['label', 'description'],
});

// ─── API reference: ParamField / ResponseField ────────────────────────────────
// Modeled as block components so they round-trip losslessly (their attributes are
// preserved through serialize/parse). Inline attribute editing is a follow-up; the
// body (description) is fully editable.
export const ParamField = containerNode({
  name: 'mdxParamField',
  tag: 'ParamField',
  content: 'block+',
  className: 'pl-paramfield',
  attrs: stringAttrs('path', 'query', 'header', 'body', 'name', 'type', 'required', 'default', 'deprecated'),
  attrKeys: ['path', 'query', 'header', 'body', 'name', 'type', 'required', 'default', 'deprecated'],
});
export const ResponseField = containerNode({
  name: 'mdxResponseField',
  tag: 'ResponseField',
  content: 'block+',
  className: 'pl-responsefield',
  attrs: stringAttrs('name', 'type', 'required', 'default', 'deprecated'),
  attrKeys: ['name', 'type', 'required', 'default', 'deprecated'],
});

// ─── CodeGroup (tabbed code blocks) ───────────────────────────────────────────
export const CodeGroup = containerNode({ name: 'mdxCodeGroup', tag: 'CodeGroup', content: 'block+', className: 'pl-codegroup' });

// ─── Layout and inline UI ────────────────────────────────────────────────────
export const Columns = containerNode({ name: 'mdxColumns', tag: 'Columns', content: 'mdxColumn+', className: 'pl-columns' });
export const Column = containerNode({ name: 'mdxColumn', tag: 'Column', content: 'block+', className: 'pl-column' });
export const Banner = containerNode({
  name: 'mdxBanner',
  tag: 'Banner',
  content: 'block+',
  className: 'pl-banner',
  attrs: stringAttrs('type', 'dismissible'),
  attrKeys: ['type', 'dismissible'],
});
export const Badge = inlineWrapperNode({ name: 'mdxBadge', tag: 'Badge', className: 'pl-badge', attrs: stringAttr('color'), attrKeys: ['color'] });
export const MdxButton = inlineWrapperNode({
  name: 'mdxButton',
  tag: 'Button',
  className: 'pl-button',
  attrs: stringAttrs('href', 'variant'),
  attrKeys: ['href', 'variant'],
});

// ─── Inline: Tooltip ──────────────────────────────────────────────────────────
// `<Tooltip tip="…">text</Tooltip>` — an inline wrapper whose children stay
// editable. Serializes with `renderInline` (NOT the block factory's
// renderContent/closeBlock) so the tag and its text stay on the same line.
export const Tooltip = Node.create({
  name: 'mdxTooltip',
  group: 'inline',
  inline: true,
  content: 'inline*',
  addAttributes: () => stringAttr('tip'),
  parseHTML: () => [{ tag: 'tooltip' }, { tag: 'span[data-mdx="Tooltip"]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-mdx': 'Tooltip', class: 'pl-tooltip' }), 0],
  addStorage: () => ({
    markdown: {
      serialize: (state: SerializeState, node: PMNode) => {
        state.write(`<Tooltip${attrString(node, ['tip'])}>`);
        state.renderInline(node);
        state.write('</Tooltip>');
      },
      parse: {},
    } satisfies MarkdownNodeSpec,
  }),
});

// ─── Inline: Icon ─────────────────────────────────────────────────────────────
// `<Icon icon|name color size />` — a self-closing inline atom. It carries no
// content, so it parses as a leaf (atom) that never absorbs following siblings,
// and serializes as a self-closing tag.
export const Icon = Node.create({
  name: 'mdxIcon',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => stringAttrs('icon', 'name', 'color', 'size'),
  parseHTML: () => [{ tag: 'icon' }, { tag: 'span[data-mdx="Icon"]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-mdx': 'Icon', class: 'pl-icon' })],
  addStorage: () => ({
    markdown: {
      serialize: (state: SerializeState, node: PMNode) => {
        state.write(`<Icon${attrString(node, ['icon', 'name', 'color', 'size'])} />`);
      },
      parse: {},
    } satisfies MarkdownNodeSpec,
  }),
});

/** All MDX component nodes, for the editor's extension list. Modeling every
 *  renderer-supported component here is what keeps the editor↔live-site round-trip
 *  lossless — an unmodeled tag would be silently dropped on the next save. */
export const mdxNodes = [
  Steps,
  Step,
  CardGroup,
  Card,
  Tabs,
  Tab,
  AccordionGroup,
  Accordion,
  Frame,
  Expandable,
  Update,
  ParamField,
  ResponseField,
  CodeGroup,
  Columns,
  Column,
  Banner,
  Badge,
  MdxButton,
  Tooltip,
  Icon,
];
