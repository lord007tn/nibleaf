import type { Attributes } from '@tiptap/core';
import { mergeAttributes, Node } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { MarkdownNodeSpec } from 'tiptap-markdown';
import { preservedClosingTag, preservedOpeningTag, sourceMetadataAttributes, writeBlockTag } from '../mdx-roundtrip';
import { TitledBlockView } from '../titled-block-view';

/**
 * TipTap nodes for the Mintlify-style MDX components the live site renders
 * (see components/site/mdx/). Each authors as a visual block in the
 * WYSIWYG editor and round-trips to its MDX tag in the stored Markdown.
 *
 * Round-trip (paired with `Markdown.configure({ html: true })`):
 *  - serialize → `<Tag attr="…">\n\n …content… \n\n</Tag>` (blank lines so the
 *    Markdown inside the component is parsed as Markdown, not raw text).
 *  - parse → markdown-it (html:true) keeps the raw tags as HTML blocks; the
 *    browser nests them and our `parseHTML` tag matchers rebuild the nodes.
 */

export type SerializeState = {
  write: (text: string) => void;
  closeBlock: (node: PMNode) => void;
  atBlank?: () => boolean;
  renderContent: (node: PMNode) => void;
  renderInline: (node: PMNode) => void;
};

/** A serializer that writes an MDX block tag wrapping its (blank-line-padded) content. */
const mdxBlockSerializer =
  (tag: string, attrKeys: string[]) =>
  (state: SerializeState, node: PMNode): void => {
    writeBlockTag(state, node, preservedOpeningTag(node, tag, attrKeys));
    state.renderContent(node);
    writeBlockTag(state, node, preservedClosingTag(node, tag));
  };

const markdownStorage = (tag: string, attrKeys: string[]) => ({
  markdown: { serialize: mdxBlockSerializer(tag, attrKeys), parse: {} } satisfies MarkdownNodeSpec,
});

/** A string attribute that parses from `attr`/`data-attr` and renders to `data-attr`. */
export const stringAttr = (name: string): Attributes => ({
  [name]: {
    default: '',
    parseHTML: (element) => element.getAttribute(name) ?? element.getAttribute(`data-${name}`) ?? '',
    renderHTML: (attributes) => (attributes[name] ? { [`data-${name}`]: attributes[name] as string } : {}),
  },
});

/** A boolean attribute (presence / "true"). */
export const boolAttr = (name: string): Attributes => ({
  [name]: {
    default: false,
    parseHTML: (element) => {
      const dataValue = element.getAttribute(`data-${name}`);
      if (dataValue != null) return dataValue === 'true' ? true : dataValue;
      return element.hasAttribute(name);
    },
    renderHTML: (attributes) => (attributes[name] ? { [`data-${name}`]: String(attributes[name]) } : {}),
  },
});

/** Merge several string attributes by name. */
export const stringAttrs = (...names: string[]): Attributes => Object.assign({}, ...names.map(stringAttr));

/** A simple wrapper node (no title) holding `content`, e.g. Steps / Tabs / CardGroup. */
export const containerNode = (config: { name: string; tag: string; content: string; className: string; attrs?: Attributes; attrKeys?: string[] }) =>
  Node.create({
    name: config.name,
    group: 'block',
    content: config.content,
    defining: true,
    addAttributes: () => ({ ...(config.attrs ?? {}), ...sourceMetadataAttributes() }),
    parseHTML: () => [{ tag: config.tag.toLowerCase() }, { tag: `div[data-mdx="${config.tag}"]` }],
    renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-mdx': config.tag, class: config.className }), 0],
    addStorage: () => markdownStorage(config.tag, config.attrKeys ?? []),
  });

/** A title-bearing block (Step / Card / Tab / Accordion / Frame): an editable
 *  title input (via the React node view) above an editable body. */
export const titledNode = (config: { name: string; tag: string; className: string; attrs?: Attributes; attrKeys: string[] }) =>
  Node.create({
    name: config.name,
    group: 'block',
    content: 'block+',
    defining: true,
    addAttributes: () => ({ ...(config.attrs ?? {}), ...sourceMetadataAttributes() }),
    parseHTML: () => [{ tag: config.tag.toLowerCase() }, { tag: `div[data-mdx="${config.tag}"]` }],
    renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-mdx': config.tag, class: config.className }), 0],
    addNodeView: () => ReactNodeViewRenderer(TitledBlockView),
    addStorage: () => markdownStorage(config.tag, config.attrKeys),
  });

/** A self-closing, attribute-only MDX block such as `<File name="…" />`. */
export const atomNode = (config: { name: string; tag: string; className: string; attrs: Attributes; attrKeys: string[] }) =>
  Node.create({
    name: config.name,
    group: 'block',
    atom: true,
    selectable: true,
    defining: true,
    addAttributes: () => ({ ...config.attrs, ...sourceMetadataAttributes() }),
    parseHTML: () => [{ tag: config.tag.toLowerCase() }, { tag: `div[data-mdx="${config.tag}"]` }],
    renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-mdx': config.tag, class: config.className })],
    addNodeView: () => ReactNodeViewRenderer(TitledBlockView),
    addStorage: () => ({
      markdown: {
        serialize(state: SerializeState, node: PMNode) {
          writeBlockTag(state, node, preservedOpeningTag(node, config.tag, config.attrKeys, true));
        },
        parse: {},
      } satisfies MarkdownNodeSpec,
    }),
  });

export const inlineWrapperNode = (config: { name: string; tag: string; className: string; attrs?: Attributes; attrKeys: string[] }) =>
  Node.create({
    name: config.name,
    group: 'inline',
    inline: true,
    content: 'inline*',
    addAttributes: () => ({ ...(config.attrs ?? {}), ...sourceMetadataAttributes() }),
    parseHTML: () => [{ tag: config.tag.toLowerCase() }, { tag: `span[data-mdx="${config.tag}"]` }],
    renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-mdx': config.tag, class: config.className }), 0],
    addStorage: () => ({
      markdown: {
        serialize: (state: SerializeState, node: PMNode) => {
          state.write(preservedOpeningTag(node, config.tag, config.attrKeys));
          state.renderInline(node);
          state.write(preservedClosingTag(node, config.tag));
        },
        parse: {},
      } satisfies MarkdownNodeSpec,
    }),
  });
