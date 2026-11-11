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
const SELECTION_MENU_META = 'nibleafSelectionMenu';

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
const RTL_LETTER =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}]/u;
const LETTER = /\p{L}/u;

/** A letter's writing direction; marks, digits and joining punctuation have none. */
const directionOf = (character: string): 'rtl' | 'ltr' | null => (RTL_LETTER.test(character) ? 'rtl' : LETTER.test(character) ? 'ltr' : null);

/** The word segment holding the caret (or ending at it), as string offsets. */
function wordSegment(text: string, offset: number, locale: string | undefined): { start: number; end: number } | null {
  if (typeof Intl.Segmenter !== 'function') {
    // Without a segmenter, the run of letters, marks and digits around the caret.
    let start = offset;
    let end = offset;
    while (start > 0 && WORD_CHARACTER.test(text.charAt(start - 1))) start -= 1;
    while (end < text.length && WORD_CHARACTER.test(text.charAt(end))) end += 1;
    return start === end ? null : { start, end };
  }
  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
  } catch {
    segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  }
  let endingHere: { start: number; end: number } | null = null;
  for (const { segment, index, isWordLike } of segmenter.segment(text)) {
    if (!isWordLike) continue;
    const end = index + segment.length;
    if (index <= offset && offset < end) return { start: index, end };
    if (end === offset) endingHere = { start: index, end };
    if (index > offset) break;
  }
  return endingHere;
}

/**
 * The word the caret touches, as document positions, or null between words.
 * Words follow the language's segmentation (`don't` is one word, a letter
 * outside the Basic Multilingual Plane is never split), and stop where the
 * writing direction changes, so `الدليلAPI` gives the Arabic or the Latin run
 * the caret is in.
 */
function wordAround($pos: ResolvedPos, locale?: string): { from: number; to: number } | null {
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;
  // One character per inline leaf (images, hard breaks), so string offsets stay
  // document offsets. Positions count UTF-16 units, as strings do.
  const text = parent.textBetween(0, parent.content.size, undefined, '￼');
  const offset = $pos.parentOffset;
  const segment = wordSegment(text, offset, locale);
  if (!segment) return null;
  // Code points of the segment with their offsets; the caret's direction comes
  // from the letter after it, or the one before it at the end of the word.
  const points: Array<{ at: number; direction: 'rtl' | 'ltr' | null }> = [];
  for (let at = segment.start; at < segment.end; ) {
    const point = String.fromCodePoint(text.codePointAt(at) ?? 0);
    points.push({ at, direction: directionOf(point) });
    at += point.length;
  }
  const caretIndex = points.findIndex((point) => point.at >= offset);
  const after = caretIndex < 0 ? points.length : caretIndex;
  const direction =
    points.slice(after).find((point) => point.direction)?.direction ??
    points
      .slice(0, after)
      .reverse()
      .find((point) => point.direction)?.direction ??
    null;
  let first = 0;
  let last = points.length;
  if (direction) {
    const other = direction === 'rtl' ? 'ltr' : 'rtl';
    for (let index = after - 1; index >= 0; index -= 1) {
      if (points[index]?.direction === other) {
        first = index + 1;
        break;
      }
    }
    for (let index = after; index < points.length; index += 1) {
      if (points[index]?.direction === other) {
        last = index;
        break;
      }
    }
  }
  const start = points[first]?.at ?? segment.start;
  const end = points[last]?.at ?? segment.end;
  if (start >= end) return null;
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
              // Words are split by the page's language (the editor's `lang`).
              const locale = view.dom.closest('[lang]')?.getAttribute('lang') || undefined;
              const word = wordAround(state.selection.$from, locale);
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
