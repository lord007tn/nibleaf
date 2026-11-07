import { mergeAttributes, Node } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { MarkdownNodeSpec } from 'tiptap-markdown';
import { preservedOpeningTag, sourceMetadataAttributes } from '../mdx-roundtrip';
import { type SerializeState, stringAttrs } from './factories';

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
  addAttributes: () => ({ ...stringAttrs('icon', 'name', 'color', 'size'), ...sourceMetadataAttributes() }),
  parseHTML: () => [{ tag: 'icon' }, { tag: 'span[data-mdx="Icon"]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-mdx': 'Icon', class: 'pl-icon' })],
  addStorage: () => ({
    markdown: {
      serialize: (state: SerializeState, node: PMNode) => {
        state.write(preservedOpeningTag(node, 'Icon', ['icon', 'name', 'color', 'size'], true));
      },
      parse: {},
    } satisfies MarkdownNodeSpec,
  }),
});
