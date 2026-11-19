// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, expect, it } from 'vitest';
import {
  LIST_ITEM_FIRST_BLOCK_CASES,
  LIST_ITEM_MAIN_TOGGLE_OVERLAP,
  type ListItemRepair,
  repairedListItem,
} from './__fixtures__/list-item-first-block';
import { applyCorpusEdits, type DifferentialEditor, type MarkEditor, serializerCorpus, withMainCodeToggle } from './__fixtures__/serializer-corpus';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

const cases = serializerCorpus();
const editors: Editor[] = [];
const open = (source: string) => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  editors.push(editor);
  editor.commands.setContent(source, { emitUpdate: false });
  return editor;
};
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function check(editor: Editor, repair: ListItemRepair): void {
  const saved = getMarkdown(editor);
  expect(saved).toBe(repairedListItem(repair));
  // Preserve every fixed point main already had. Unrelated pre-existing main
  // normalization remains pinned byte for byte above rather than hidden here.
  if (repair.mainFixed) expect(getMarkdown(open(saved))).toBe(saved);
}

it('names exactly 14 source pages for the #604 list repair', () => {
  expect(LIST_ITEM_FIRST_BLOCK_CASES.map(({ index }) => index)).toEqual([42, 59, 135, 246, 347, 418, 550, 602, 621, 653, 785, 809, 937, 997]);
});

it.each(LIST_ITEM_FIRST_BLOCK_CASES)('page $index is main’s result minus the #604 bug, before and after edits', (fixture) => {
  const page = cases[fixture.index];
  expect(page?.source).toBe(fixture.source);
  if (!page) throw new Error('Missing named list page');
  const editor = open(page.source);
  check(editor, fixture.unmodified);
  applyCorpusEdits(editor as unknown as DifferentialEditor, page.edits);
  check(editor, fixture.corpusEdit);

  editor.commands.setContent(page.source, { emitUpdate: false });
  let target: { pos: number; attrs: Record<string, unknown> } | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (!target && 'title' in node.attrs) target = { pos, attrs: node.attrs };
  });
  expect(!!target).toBe(fixture.attributeEdit !== null);
  if (target && fixture.attributeEdit) {
    editor.view.dispatch(editor.state.tr.setNodeMarkup(target.pos, undefined, { ...target.attrs, title: 'Edited' }));
    check(editor, fixture.attributeEdit);
  }
});

it('page 550 with main’s code toggle still changes only the named list prefix', () => {
  const page = cases[LIST_ITEM_MAIN_TOGGLE_OVERLAP.index];
  if (!page) throw new Error('Missing overlap page');
  const editor = open(page.source);
  applyCorpusEdits(withMainCodeToggle(editor as unknown as MarkEditor), page.edits);
  check(editor, LIST_ITEM_MAIN_TOGGLE_OVERLAP.corpusEdit);
});
