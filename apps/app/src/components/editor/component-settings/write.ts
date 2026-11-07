import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { type SettingsTarget, targetNode } from './schema';

/**
 * Apply attribute changes to a component node.
 *  - `commit` is one undo step of its own (a toggle, a pick, a finished text edit).
 *  - `preview` updates the document live without touching undo history; a
 *    following `finishPreview` turns the whole run into a single undo step.
 */
export function writeComponentAttributes(
  editor: Editor,
  target: SettingsTarget,
  attributes: Record<string, unknown>,
  mode: 'commit' | 'preview' = 'commit',
): boolean {
  const node = targetNode(editor.state, target);
  if (!node || editor.isDestroyed) return false;
  const tr = editor.state.tr.setNodeMarkup(target.pos, undefined, { ...node.attrs, ...attributes });
  editor.view.dispatch(mode === 'commit' ? closeHistory(tr) : tr.setMeta('addToHistory', false));
  return true;
}

/** Turn a run of previews into one undo step from `initial` to the current value. */
export function finishPreview(editor: Editor, target: SettingsTarget, name: string, initial: unknown): void {
  const node = targetNode(editor.state, target);
  if (!node) return;
  const current = node.attrs[name];
  if (JSON.stringify(current ?? '') === JSON.stringify(initial ?? '')) return;
  writeComponentAttributes(editor, target, { [name]: initial }, 'preview');
  writeComponentAttributes(editor, target, { [name]: current }, 'commit');
}
