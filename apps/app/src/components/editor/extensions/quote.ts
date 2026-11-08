import Blockquote from '@tiptap/extension-blockquote';
import type { MarkdownNodeSpec } from 'tiptap-markdown';

/**
 * Plain `>` quotes, saved like tiptap-markdown's own blockquote except for one
 * step. tiptap-markdown records where a paragraph's first bold or italic mark
 * opens before it writes the pending blank line and the `> ` prefix, so the
 * delimiter lands in front of the `>`: `**second**` after another paragraph or
 * an image saved as `****second**`, then merged into the paragraph above on
 * the next save. Writing that line and prefix first, as the GitHub alert
 * serializer does (callout.ts), puts the delimiter after the prefix.
 */
export const MarkdownBlockquote = Blockquote.extend({
  addStorage() {
    const markdown: MarkdownNodeSpec = {
      serialize(state, node) {
        state.wrapBlock('> ', null, node, () =>
          node.forEach((child, _offset, index) => {
            if (child.type.name === 'paragraph' && child.childCount > 0) state.write();
            state.render(child, node, index);
          }),
        );
      },
      // markdown-it parses quotes.
      parse: {},
    };
    return { markdown };
  },
});
