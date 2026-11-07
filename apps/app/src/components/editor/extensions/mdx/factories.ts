import { DOCUMENTATION_COMPONENTS, type DocumentationComponentAttribute } from '@nibleaf/shared/documentation-components';
import type { Attributes } from '@tiptap/core';
import { mergeAttributes, Node } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { MarkdownNodeSpec } from 'tiptap-markdown';
import { preservedClosingTag, preservedOpeningTag, SUPPORTED_MDX_COMPONENTS, sourceMetadataAttributes, writeBlockTag } from '../mdx-roundtrip';
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

/** The props a tag serializes, in order: the registry's attributes for that
 *  component (editor-only ones included), so a prop added there is never
 *  dropped on save by a hand-kept list. */
export const attrKeysOf = (tag: string): string[] => {
  const definition = SUPPORTED_MDX_COMPONENTS[tag.toLowerCase()];
  if (!definition) throw new Error(`<${tag}> is not in the documentation component registry`);
  return definition.attrs;
};

const SELF_CLOSING_OPENER = /\s*\/\s*>$/;
const hasNoBody = (node: PMNode): boolean =>
  node.childCount === 0 || (node.childCount === 1 && node.firstChild?.type.name === 'paragraph' && node.firstChild.content.size === 0);

/** A serializer that writes an MDX block tag wrapping its (blank-line-padded)
 *  content. An authored self-closing tag (`<RelatedCard … />`) stays one while
 *  it has no body: a closing tag after it breaks MDX compilers. Once the writer
 *  gives it a body, it is written as an opening and closing pair. */
const mdxBlockSerializer =
  (tag: string) =>
  (state: SerializeState, node: PMNode): void => {
    const opening = preservedOpeningTag(node, tag, attrKeysOf(tag));
    if (SELF_CLOSING_OPENER.test(opening) && hasNoBody(node)) {
      writeBlockTag(state, node, opening);
      return;
    }
    writeBlockTag(state, node, opening.replace(SELF_CLOSING_OPENER, '>'));
    state.renderContent(node);
    writeBlockTag(state, node, preservedClosingTag(node, tag));
  };

const markdownStorage = (tag: string) => ({
  markdown: { serialize: mdxBlockSerializer(tag), parse: {} } satisfies MarkdownNodeSpec,
});

/** An atom's tag, always well-formed. Atoms have no body, but an author may
 *  have written the pair (`<File name="x"></File>`); writing only that opener
 *  back would make the reader swallow everything after it, so an opener that
 *  is not self-closing keeps (or gains) its closing tag. */
export const atomTag = (node: PMNode, tag: string): string => {
  const opening = preservedOpeningTag(node, tag, attrKeysOf(tag), true);
  return /\/\s*>$/.test(opening) ? opening : `${opening}${preservedClosingTag(node, tag)}`;
};

/** A string attribute that parses from `attr`/`data-attr` and renders to `data-attr`. */
const stringAttr = (name: string, fallback = ''): Attributes => ({
  [name]: {
    default: fallback,
    parseHTML: (element) => element.getAttribute(name) ?? element.getAttribute(`data-${name}`) ?? fallback,
    renderHTML: (attributes) => (attributes[name] ? { [`data-${name}`]: attributes[name] as string } : {}),
  },
});

/** A boolean attribute: "false" is false; presence, "" or "true" is true. */
const boolAttr = (name: string): Attributes => ({
  [name]: {
    default: false,
    parseHTML: (element) => {
      const dataValue = element.getAttribute(`data-${name}`);
      if (dataValue != null) {
        const normalized = dataValue.trim().toLowerCase();
        if (normalized === 'false') return false;
        // Any other non-boolean value (an expression such as `{open}`) is
        // kept verbatim so the author's source round-trips.
        return normalized === '' || normalized === 'true' ? true : dataValue;
      }
      const value = element.getAttribute(name);
      return value != null && value.trim().toLowerCase() !== 'false';
    },
    renderHTML: (attributes) => (attributes[name] ? { [`data-${name}`]: String(attributes[name]) } : {}),
  },
});

/** A presence flag kept the way it was authored (`required`, `deprecated`):
 *  bare or "true" reads as true and is written back bare; any other value is
 *  kept as text. Absent is the empty string, like a string attribute. */
const flagAttr = (name: string): Attributes => ({
  [name]: {
    default: '',
    parseHTML: (element) => {
      const value = element.getAttribute(name) ?? element.getAttribute(`data-${name}`);
      if (value == null) return '';
      return value === '' || value === 'true' ? true : value;
    },
    renderHTML: (attributes) => (attributes[name] ? { [`data-${name}`]: String(attributes[name]) } : {}),
  },
});

/** The node attribute for one registry attribute: a presence flag, a
 *  true/false switch, or text (strings, URLs, icons, colours, enums and
 *  numbers), defaulting to the registry's default. */
const registryAttribute = (attribute: DocumentationComponentAttribute): Attributes => {
  if (attribute.type === 'boolean') return attribute.presence ? flagAttr(attribute.name) : boolAttr(attribute.name);
  return stringAttr(attribute.name, attribute.default === undefined ? '' : String(attribute.default));
};

/** Every node attribute of a component, derived from the registry so the
 *  editor parses, stores and defaults each prop the way the registry says. */
export const registryAttributes = (tag: string): Attributes => {
  const component = DOCUMENTATION_COMPONENTS.find((candidate) => candidate.tag === tag);
  if (!component) throw new Error(`<${tag}> is not in the documentation component registry`);
  return Object.assign({}, ...component.attributes.map(registryAttribute));
};

/** A simple wrapper node (no title) holding `content`, e.g. Steps / Tabs / CardGroup. */
export const containerNode = (config: { name: string; tag: string; content: string; className: string }) =>
  Node.create({
    name: config.name,
    group: 'block',
    content: config.content,
    defining: true,
    addAttributes: () => ({ ...registryAttributes(config.tag), ...sourceMetadataAttributes() }),
    parseHTML: () => [{ tag: config.tag.toLowerCase() }, { tag: `div[data-mdx="${config.tag}"]` }],
    renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-mdx': config.tag, class: config.className }), 0],
    addStorage: () => markdownStorage(config.tag),
  });

/** A title-bearing block (Step / Card / Tab / Accordion / Frame): an editable
 *  title input (via the React node view) above an editable body. */
export const titledNode = (config: { name: string; tag: string; className: string }) =>
  Node.create({
    name: config.name,
    group: 'block',
    content: 'block+',
    defining: true,
    addAttributes: () => ({ ...registryAttributes(config.tag), ...sourceMetadataAttributes() }),
    parseHTML: () => [{ tag: config.tag.toLowerCase() }, { tag: `div[data-mdx="${config.tag}"]` }],
    renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-mdx': config.tag, class: config.className }), 0],
    addNodeView: () => ReactNodeViewRenderer(TitledBlockView),
    addStorage: () => markdownStorage(config.tag),
  });

/** A self-closing, attribute-only MDX block such as `<File name="…" />`. */
export const atomNode = (config: { name: string; tag: string; className: string }) =>
  Node.create({
    name: config.name,
    group: 'block',
    atom: true,
    selectable: true,
    defining: true,
    addAttributes: () => ({ ...registryAttributes(config.tag), ...sourceMetadataAttributes() }),
    parseHTML: () => [{ tag: config.tag.toLowerCase() }, { tag: `div[data-mdx="${config.tag}"]` }],
    renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-mdx': config.tag, class: config.className })],
    addNodeView: () => ReactNodeViewRenderer(TitledBlockView),
    addStorage: () => ({
      markdown: {
        serialize(state: SerializeState, node: PMNode) {
          writeBlockTag(state, node, atomTag(node, config.tag));
        },
        parse: {},
      } satisfies MarkdownNodeSpec,
    }),
  });

export const inlineWrapperNode = (config: { name: string; tag: string; className: string }) =>
  Node.create({
    name: config.name,
    group: 'inline',
    inline: true,
    content: 'inline*',
    addAttributes: () => ({ ...registryAttributes(config.tag), ...sourceMetadataAttributes() }),
    parseHTML: () => [{ tag: config.tag.toLowerCase() }, { tag: `span[data-mdx="${config.tag}"]` }],
    renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-mdx': config.tag, class: config.className }), 0],
    addStorage: () => ({
      markdown: {
        serialize: (state: SerializeState, node: PMNode) => {
          state.write(preservedOpeningTag(node, config.tag, attrKeysOf(config.tag)));
          state.renderInline(node);
          state.write(preservedClosingTag(node, config.tag));
        },
        parse: {},
      } satisfies MarkdownNodeSpec,
    }),
  });
