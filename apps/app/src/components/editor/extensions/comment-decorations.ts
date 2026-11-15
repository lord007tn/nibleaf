import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/** A comment's anchor data the editor needs to draw + locate its highlight. */
export interface CommentMarker {
  id: string;
  quote: string;
  resolved?: boolean;
}

export interface CommentDecorationOptions {
  /** Read the current comments (called on every transaction, compared by content). */
  getComments: () => CommentMarker[];
  /** The focused comment id (drawn stronger), if any. */
  getActiveId: () => string | null;
  /** How long the document must stay unchanged before the highlights are found
   *  again after an edit (they are mapped through the edit meanwhile). */
  idleMs?: number;
}

/** The default `idleMs`. */
const COMMENT_REANCHOR_IDLE_MS = 300;

const commentKey = new PluginKey<CommentDecorationState>('nibleaf-comment-decorations');

/** The document's text with each character's position: what quotes are matched in. */
function documentText(doc: PMNode): { text: string; posAt: Array<number | null> } {
  let text = '';
  const posAt: Array<number | null> = [];
  doc.descendants((node, pos) => {
    // Opaque MDX has no editable/commentable text. Insert a hard sentinel so a
    // quote can never re-anchor by accidentally joining text from both sides.
    // Anchors wholly before or after the atom keep their normal positions.
    if (node.type.name === 'mdxOpaqueBlock' || node.type.name === 'mdxOpaqueInline') {
      text += '￼';
      posAt.push(null);
      return false;
    }
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        posAt.push(pos + i);
        text += node.text[i];
      }
    }
    return true;
  });
  return { text, posAt };
}

function rangeIn({ text, posAt }: { text: string; posAt: Array<number | null> }, quote: string): { from: number; to: number } | null {
  const needle = quote.trim();
  if (!needle) {
    return null;
  }
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

/**
 * Locate a `quote` in the document and return its [from, to] ProseMirror range.
 * Page content is Markdown (no stable node ids), so a comment is re-anchored by
 * matching its quoted text — we build the doc's text with a position map and find
 * the first occurrence. Returns null when the quote no longer exists (the comment
 * is then shown in the panel but un-highlighted).
 */
export function findQuoteRange(doc: PMNode, quote: string): { from: number; to: number } | null {
  return quote.trim() ? rangeIn(documentText(doc), quote) : null;
}

/** The highlight decorations for `comments` in `doc`, found from scratch. The
 *  document's text is built once for all of them. */
function commentDecorations(doc: PMNode, comments: CommentMarker[], activeId: string | null): DecorationSet {
  const open = comments.filter((comment) => !comment.resolved && comment.quote.trim());
  if (open.length === 0) {
    return DecorationSet.empty;
  }
  const text = documentText(doc);
  const decos: Decoration[] = [];
  for (const comment of open) {
    const range = rangeIn(text, comment.quote);
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
  return DecorationSet.create(doc, decos);
}

interface CommentDecorationState {
  decorations: DecorationSet;
  /** What the decorations were found for: the comments and the active id. */
  signature: string;
  /** The document changed since: the mapped highlights are found again once it settles. */
  stale: boolean;
}

const signatureOf = (comments: CommentMarker[], activeId: string | null): string =>
  JSON.stringify([activeId, comments.map((comment) => [comment.id, comment.quote, comment.resolved === true])]);

/** Edits up to this size (characters replaced or inserted) map the highlights. */
const LOCAL_EDIT_SIZE = 64;

/** How much of the document `tr` replaced: the larger side of each changed range. */
function changedSize(tr: Transaction): number {
  let size = 0;
  for (const map of tr.mapping.maps) {
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      size += Math.max(oldEnd - oldStart, newEnd - newStart);
    });
  }
  return size;
}

/** Ask the plugin to find the highlights again now. */
const reanchorTransaction = (tr: Transaction): Transaction =>
  tr.setMeta(commentKey, 'reanchor').setMeta('addToHistory', false).setMeta('preventUpdate', true).setMeta('skipTrailingNode', true);

/**
 * Comment highlights (P2-ED-005). They used to be found from scratch, a walk of
 * the whole document per comment, on every update, keystrokes included. They are
 * kept in the plugin's state now:
 * - found from scratch when the comments or the active comment change;
 * - mapped through each keystroke-sized edit, so a highlight moves with the text
 *   around it (a larger edit, such as a page seeded or a paste, finds them at once);
 * - found from scratch again once the document has been unchanged for `idleMs`,
 *   so they end up exactly where a fresh search puts them.
 */
export const CommentDecorations = Extension.create<CommentDecorationOptions>({
  name: 'commentDecorations',

  addOptions() {
    return { getComments: () => [], getActiveId: () => null, idleMs: COMMENT_REANCHOR_IDLE_MS };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    // The signature of the comments last read, kept while the same array and id come back.
    let read: { comments: CommentMarker[]; activeId: string | null; signature: string } | null = null;
    const current = () => {
      const comments = options.getComments();
      const activeId = options.getActiveId();
      if (!read || read.comments !== comments || read.activeId !== activeId)
        read = { comments, activeId, signature: signatureOf(comments, activeId) };
      return read;
    };
    const find = (doc: PMNode): CommentDecorationState => {
      const { comments, activeId, signature } = current();
      return { decorations: commentDecorations(doc, comments, activeId), signature, stale: false };
    };
    return [
      new Plugin<CommentDecorationState>({
        key: commentKey,
        state: {
          init: (_config, state) => find(state.doc),
          apply(tr, previous, _oldState, newState) {
            if (tr.getMeta(commentKey) === 'reanchor') return find(newState.doc);
            if (current().signature !== previous.signature) return find(newState.doc);
            if (!tr.docChanged) return previous;
            // More than a keystroke's worth (a page seeded, a paste): find them now.
            if (changedSize(tr) > LOCAL_EDIT_SIZE) return find(newState.doc);
            const decorations = previous.decorations.map(tr.mapping, tr.doc);
            // The edit removed a highlight's text: find them now rather than show
            // none until the pause.
            if (decorations.find().length !== previous.decorations.find().length) return find(newState.doc);
            return { ...previous, decorations, stale: true };
          },
        },
        view() {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const reanchorLater = (view: EditorView) => {
            clearTimeout(timer);
            timer = setTimeout(() => {
              timer = undefined;
              if (view.isDestroyed || !commentKey.getState(view.state)?.stale) return;
              // Never redraw under an IME composition: try again after it.
              if (view.composing) {
                reanchorLater(view);
                return;
              }
              view.dispatch(reanchorTransaction(view.state.tr));
            }, options.idleMs ?? COMMENT_REANCHOR_IDLE_MS);
          };
          return {
            update(view, previousState) {
              if (view.state.doc !== previousState.doc && commentKey.getState(view.state)?.stale) reanchorLater(view);
            },
            destroy() {
              clearTimeout(timer);
            },
          };
        },
        props: {
          decorations(state) {
            return commentKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
