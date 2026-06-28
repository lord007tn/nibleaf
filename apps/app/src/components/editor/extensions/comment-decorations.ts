import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** A comment's anchor data the editor needs to draw + locate its highlight. */
export interface CommentMarker {
  id: string;
  quote: string;
  resolved?: boolean;
}

export interface CommentDecorationOptions {
  /** Read the current comments (called on every decoration pass). */
  getComments: () => CommentMarker[];
  /** The focused comment id (drawn stronger), if any. */
  getActiveId: () => string | null;
}

const commentKey = new PluginKey('plume-comment-decorations');

/**
 * Locate a `quote` in the document and return its [from, to] ProseMirror range.
 * Page content is Markdown (no stable node ids), so a comment is re-anchored by
 * matching its quoted text — we build the doc's text with a position map and find
 * the first occurrence. Returns null when the quote no longer exists (the comment
 * is then shown in the panel but un-highlighted).
 */
export function findQuoteRange(doc: PMNode, quote: string): { from: number; to: number } | null {
  const needle = quote.trim();
  if (!needle) {
    return null;
  }
  let text = '';
  const posAt: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        posAt.push(pos + i);
        text += node.text[i];
      }
    }
    return true;
  });
  const idx = text.indexOf(needle);
  if (idx < 0) {
    return null;
  }
  const from = posAt[idx];
  const to = posAt[idx + needle.length - 1];
  if (from == null || to == null) {
    return null;
  }
  return { from, to: to + 1 };
}

export const CommentDecorations = Extension.create<CommentDecorationOptions>({
  name: 'commentDecorations',

  addOptions() {
    return { getComments: () => [], getActiveId: () => null };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: commentKey,
        props: {
          decorations(state) {
            const comments = options.getComments();
            if (comments.length === 0) {
              return DecorationSet.empty;
            }
            const activeId = options.getActiveId();
            const decos: Decoration[] = [];
            for (const comment of comments) {
              if (comment.resolved) {
                continue;
              }
              const range = findQuoteRange(state.doc, comment.quote);
              if (!range) {
                continue;
              }
              decos.push(
                Decoration.inline(range.from, range.to, {
                  class: comment.id === activeId ? 'pl-comment-highlight pl-comment-active' : 'pl-comment-highlight',
                  'data-comment-id': comment.id,
                }),
              );
            }
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

export default CommentDecorations;
