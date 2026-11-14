import type { Editor } from '@tiptap/core';
import type { Plugin } from '@tiptap/pm/state';

/*
 * Seeding the editor leaves no undo history (#630). A seed replaces the whole
 * document with a copy of the page: the first load, and every re-seed of the
 * same page (a fresher server copy, a conflict merge, a restore from History, an
 * AI change). The seed's own transaction went into the undo history, so undo
 * walked back past it to the document from before, and autosave saved that older
 * copy over the newer one.
 *
 * Marking the seed `addToHistory: false` is not enough: prosemirror-history keeps
 * the earlier undo events and rebases them over the seed, so they still restore
 * the old content. Instead, after a seed the history plugin gets a fresh, empty
 * state, through the same transaction meta its undo and redo commands use to hand
 * it a new state. The document, the other plugins' state and their views are left
 * as they are.
 */

/** prosemirror-history's plugin (its key, `history`, isn't exported). */
const isHistoryPlugin = (plugin: Plugin): boolean => (plugin as unknown as { key: string }).key === 'history$';

/** Empty the undo and redo stacks: nothing before this point can be undone. */
export function clearUndoHistory(editor: Editor): void {
  const { state } = editor;
  const history = state.plugins.find(isHistoryPlugin);
  const init = history?.spec.state?.init;
  if (!history || !init) return;
  const historyState: unknown = init.call(history, {}, state);
  editor.view.dispatch(
    state.tr
      .setMeta(history, { redo: false, historyState })
      // Not an edit, and nothing to tidy up: no update, no trailing paragraph.
      .setMeta('preventUpdate', true)
      .setMeta('skipTrailingNode', true),
  );
}
