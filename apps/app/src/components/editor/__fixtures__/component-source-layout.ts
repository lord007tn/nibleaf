import type { Editor } from '@tiptap/core';

const LAYOUT_ATTRIBUTES = ['sourceAdjacent', 'sourceNestedOpen', 'sourceNestedClose', 'sourceImageIndent', 'sourceIndentedCode'] as const;

/** Replay the old layout on the same ProseMirror nodes for the pinned main comparisons. */
export function restoreMainComponentLayout(editor: Editor): boolean {
  const transaction = editor.state.tr;
  editor.state.doc.descendants((node, position) => {
    for (const attribute of LAYOUT_ATTRIBUTES) {
      if (node.attrs[attribute] !== undefined) transaction.setNodeAttribute(position, attribute, undefined);
    }
  });
  if (!transaction.docChanged) return false;
  editor.view.dispatch(transaction.setMeta('addToHistory', false));
  return true;
}
