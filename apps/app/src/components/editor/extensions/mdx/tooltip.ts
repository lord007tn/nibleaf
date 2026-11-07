import { mergeAttributes, Node } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { MarkdownNodeSpec } from 'tiptap-markdown';
import { preservedClosingTag, preservedOpeningTag, sourceMetadataAttributes } from '../mdx-roundtrip';
import { type SerializeState, stringAttrs } from './factories';

// ─── Inline: Tooltip ──────────────────────────────────────────────────────────
// `<Tooltip tip="…">text</Tooltip>` — an inline wrapper whose children stay
// editable. Serializes with `renderInline` (NOT the block factory's
// renderContent/closeBlock) so the tag and its text stay on the same line.
export const Tooltip = Node.create({
  name: 'mdxTooltip',
  group: 'inline',
  inline: true,
  content: 'inline*',
  addAttributes: () => ({ ...stringAttrs('tip', 'headline', 'cta', 'href'), ...sourceMetadataAttributes() }),
  parseHTML: () => [{ tag: 'tooltip' }, { tag: 'span[data-mdx="Tooltip"]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-mdx': 'Tooltip', class: 'pl-tooltip' }), 0],
  addStorage: () => ({
    markdown: {
      serialize: (state: SerializeState, node: PMNode) => {
        state.write(preservedOpeningTag(node, 'Tooltip', ['tip', 'headline', 'cta', 'href']));
        state.renderInline(node);
        state.write(preservedClosingTag(node, 'Tooltip'));
      },
      parse: {},
    } satisfies MarkdownNodeSpec,
  }),
});
