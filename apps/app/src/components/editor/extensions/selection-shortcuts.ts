import { Extension, isMarkActive, isNodeActive } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import { type EditorState, NodeSelection, Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';

/**
 * Keyboard access to the selection menu (audit AUTH-10). The menu lives in
 * React, so the shortcuts ask for it through a transaction meta it listens for:
 * - Ctrl/⌘+K opens the link field for the selection, or edits the link under the
 *   caret. With a bare caret, the word around it becomes the selection.
 * - Alt-F10 moves focus into the menu's toolbar (the common rich-text binding).
 */
export const SELECTION_MENU_META = 'nibleafSelectionMenu';

export type SelectionMenuRequest = 'link' | 'toolbar';

export const selectionMenuRequest = (transaction: Transaction): SelectionMenuRequest | undefined =>
  transaction.getMeta(SELECTION_MENU_META) as SelectionMenuRequest | undefined;

/**
 * Whether the text selection menu applies: a text selection, or the caret inside
 * a link (where it acts as a link inspector). Never inside code blocks (they have
 * their own language menu and marks don't apply there) and never for table cell
 * selections (those get the table menu only, so both never stack).
 */
export function selectionMenuApplies(state: EditorState): boolean {
  const { selection } = state;
  if (isNodeActive(state, 'codeBlock') || selection instanceof CellSelection) return false;
  if (isMarkActive(state, 'link')) return true;
  return !selection.empty && !(selection instanceof NodeSelection);
}

const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_]/u;

/** The word the caret touches, as document positions, or null between words. */
export function wordAround($pos: ResolvedPos): { from: number; to: number } | null {
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;
  // One character per inline leaf (images, hard breaks), so string offsets stay
  // document offsets. Positions count UTF-16 units, as strings do.
  const text = parent.textBetween(0, parent.content.size, undefined, '￼');
  let start = $pos.parentOffset;
  let end = start;
  while (start > 0 && WORD_CHARACTER.test(text.charAt(start - 1))) start -= 1;
  while (end < text.length && WORD_CHARACTER.test(text.charAt(end))) end += 1;
  if (start === end) return null;
  const base = $pos.start();
  return { from: base + start, to: base + end };
}

/** Ctrl/⌘+K, matched as the command palette matches it, so the key is never dead. */
const isLinkShortcut = (event: KeyboardEvent) => (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k';

export const SelectionShortcuts = Extension.create({
  name: 'selectionShortcuts',

  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      new Plugin({
        key: new PluginKey('nibleafSelectionShortcuts'),
        props: {
          handleKeyDown: (view, event) => {
            if (!isLinkShortcut(event)) return false;
            // Keys that confirm or move an IME composition belong to the IME.
            if (event.isComposing || event.keyCode === 229 || view.composing) return false;
            // A read-only page has no link to add.
            if (!editor.isEditable) return false;
            const { state } = view;
            const transaction = state.tr;
            if (state.selection.empty && !isMarkActive(state, 'link')) {
              const word = wordAround(state.selection.$from);
              if (word) transaction.setSelection(TextSelection.create(state.doc, word.from, word.to));
            }
            // The page body owns the key: where no link can go (a code block, an
            // empty line) it does nothing rather than opening the command palette.
            if (selectionMenuApplies(state.apply(transaction))) {
              view.dispatch(transaction.setMeta(SELECTION_MENU_META, 'link' satisfies SelectionMenuRequest).scrollIntoView());
            }
            return true;
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      'Alt-F10': ({ editor }) => {
        if (!editor.isEditable || !selectionMenuApplies(editor.state)) return false;
        editor.view.dispatch(editor.state.tr.setMeta(SELECTION_MENU_META, 'toolbar' satisfies SelectionMenuRequest));
        return true;
      },
    };
  },
});
