// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * #606's review: edits next to the tags of a component whose children touch them. A
 * component keeps that tight layout only where it reads back the same, so every edited
 * save loads to itself:
 * - its first or last child deleted or emptied (a quote whose text is gone saves `> `,
 *   which right after the tag was read as raw text, `&gt;`): that side gets main's blank line;
 * - every child gone: main's `<Note>⏎⏎</Note>`;
 * - a blank paragraph next to the tag, or at the start of a list item or quote inside
 *   (Markdown has no empty paragraph there: it read back as an empty item and a paragraph
 *   outside the list), is not written.
 * The cases come from the reviewer's differential (421 pages × 5 edits).
 */

const editors: Editor[] = [];
const open = (markdown: string) => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  editors.push(editor);
  editor.commands.setContent(markdown, { emitUpdate: false });
  return editor;
};
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

type Edit = 'deleteFirst' | 'deleteLast' | 'blankFirst';

/** The textblocks inside the page's first component with children, in order. */
function textblocks(editor: Editor): Array<{ node: PMNode; pos: number }> {
  let component: { node: PMNode; pos: number } | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (!component && typeof node.attrs.sourceOpen === 'string' && node.attrs.sourceOpen && !node.isAtom) component = { node, pos };
  });
  const found: Array<{ node: PMNode; pos: number }> = [];
  if (!component) return found;
  editor.state.doc.nodesBetween(component.pos + 1, component.pos + component.node.nodeSize - 1, (node, pos) => {
    if (node.isTextblock) found.push({ node, pos });
  });
  return found;
}

/** Load the page, make the edit, save; the save, the edited text, and the save loaded and saved again. */
function edited(page: string, edit: Edit): { saved: string; again: string; text: string; againText: string } {
  const editor = open(page);
  const blocks = textblocks(editor);
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  if (!first || !last) throw new Error(`no component text in ${JSON.stringify(page)}`);
  if (edit === 'deleteFirst') editor.view.dispatch(editor.state.tr.delete(first.pos, first.pos + first.node.nodeSize));
  if (edit === 'deleteLast') editor.view.dispatch(editor.state.tr.delete(last.pos, last.pos + last.node.nodeSize));
  if (edit === 'blankFirst') {
    editor.commands.setTextSelection(first.pos + 1);
    editor.commands.splitBlock();
  }
  const saved = getMarkdown(editor);
  const reloaded = open(saved);
  return { saved, again: getMarkdown(reloaded), text: editor.state.doc.textContent, againText: reloaded.state.doc.textContent };
}

/** The edited save is a fixed point, loads with the same text, and shows no stray marker. */
const expectStable = (page: string, edit: Edit) => {
  const result = edited(page, edit);
  expect(result.again, `${edit} on ${JSON.stringify(page)}`).toBe(result.saved);
  expect(result.againText).toBe(result.text);
  expect(result.saved).not.toContain('&gt;');
};

// Arabic: "quoted", "first", "second", "tail".
const AR = { quoted: 'اقتباس', first: 'أول', second: 'ثان', tail: 'النهاية' };

/** A body in each place the review found: on its own, in a quote, in a list item, nested. */
const placed = (component: string): string[] => [
  `Before.\n\n${component}\n\nAfter.`,
  `Before.\n\n${component
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')}\n\nAfter.`,
  `- Item\n\n${component
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')}\n\n- Next`,
  `<Accordion title="Outer">\n\n${component}\n\n</Accordion>`,
];

describe('edits next to the tags of a component whose children touch them (#606 review)', () => {
  it('deleting a quote that opens the children leaves no raw `>` and saves to a fixed point', () => {
    const edit = edited('<Note>\n> quoted\n\nTail.\n</Note>', 'deleteFirst');
    expect(edit.saved).toBe('<Note>\n\n> \n\nTail.\n</Note>');
    expect(edit.again).toBe(edit.saved);
    for (const tag of ['Note', 'Tip', 'Warning']) {
      for (const page of placed(`<${tag}>\n> quoted\n\nTail.\n</${tag}>`)) expectStable(page, 'deleteFirst');
      for (const page of placed(`<${tag}>\n> ${AR.quoted}\n\n${AR.tail}.\n</${tag}>`)) expectStable(page, 'deleteFirst');
    }
    for (const page of placed('<Card title="A" href="/guide">\n> quoted\n\nTail.\n</Card>')) expectStable(page, 'deleteFirst');
    for (const page of placed('<Steps>\n\n<Step title="A">\n> quoted\n\nTail.\n</Step>\n\n</Steps>')) expectStable(page, 'deleteFirst');
  });

  it('emptying a component saves main’s `<Note>⏎⏎</Note>`, a fixed point', () => {
    expect(edited('<Note>\nText\n</Note>', 'deleteFirst').saved).toBe('<Note>\n\n</Note>');
    expect(edited('<Accordion title="A">\nText\n</Accordion>', 'deleteLast').saved).toBe('<Accordion title="A">\n\n</Accordion>');
    for (const page of ['<Note>\nText\n</Note>', '<Accordion title={"A"}>\nText.\n</Accordion>', `<Tip>\n${AR.first}\n</Tip>`])
      for (const edit of ['deleteFirst', 'deleteLast'] as const) for (const placedPage of placed(page)) expectStable(placedPage, edit);
  });

  it('deleting the last child, a quote, keeps the closing tag readable', () => {
    for (const page of placed('<Note>\nText.\n\n> quoted\n</Note>')) expectStable(page, 'deleteLast');
    for (const page of placed(`<Warning>\n${AR.first}.\n\n> ${AR.quoted}\n</Warning>`)) expectStable(page, 'deleteLast');
  });

  it('a blank paragraph next to the opening tag, or a table it turns into HTML there, gets main’s blank line', () => {
    expect(edited('<Note>\nText\n</Note>', 'blankFirst').saved).toBe('<Note>\n\nText\n</Note>');
    for (const page of placed('<Accordion title="A">\nText\n</Accordion>')) expectStable(page, 'blankFirst');
    // A blank paragraph in a table cell has the table written as HTML: a tag line, which
    // right after the opener was read as the raw text of the opener's HTML block.
    const table = '<Note>\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nTail.\n</Note>';
    expect(edited(table, 'blankFirst').saved).toMatch(/^<Note>\n\n<table>/);
    for (const page of placed(table)) expectStable(page, 'blankFirst');
    for (const page of placed(`<Tip title="A">\n| ${AR.first} | ${AR.second} |\n| --- | --- |\n| 1 | 2 |\n\n${AR.tail}.\n</Tip>`))
      expectStable(page, 'blankFirst');
  });

  // Deleting the first text of a list item that holds a nested list leaves the item an
  // empty paragraph and then that list. Main wrote the nested list on the next line, which
  // loaded with the list lifted out of its item. The empty paragraph is now a lead
  // (list-item-leads.ts): left out, the nested list opens on the item's own line (`- - Beta`)
  // and loads back into the item (#604).
  it('an emptied list item before its nested list keeps the nested list in the item', () => {
    const cases: Array<[string, string]> = [
      ['<Note>\n- Alpha\n  - Beta\n\n  - Charlie\n- Delta\n\nTail.\n</Note>', '<Note>\n- - Beta\n\n  - Charlie\n- Delta\n\nTail.\n</Note>'],
      ['<Note>\n1. Alpha\n   - Beta\n\n   - Gamma\n2. Delta\n\nTail.\n</Note>', '<Note>\n1. - Beta\n\n   - Gamma\n2. Delta\n\nTail.\n</Note>'],
      [
        '> <Note>\n> - Alpha\n>   - Beta\n> \n>   - Charlie\n> - Delta\n> \n> Tail.\n> </Note>',
        '> \n>\n> <Note>\n> - - Beta\n>\n>   - Charlie\n> - Delta\n>\n> Tail.\n> </Note>',
      ],
    ];
    for (const [page, saved] of cases) expect(edited(page, 'deleteFirst').saved).toBe(saved);
    for (const body of [`- ${AR.first}\n  - ${AR.second}\n- ${AR.tail}`, '- Top\n  - > Alpha', `1. ${AR.first}\n   - ${AR.second}`])
      for (const page of placed(`<Accordion title="A">\n${body}\n\nTail.\n</Accordion>`)) expectStable(page, 'deleteFirst');
  });

  it('a blank paragraph at the start of a list item or quote opening the children is not written', () => {
    expect(edited('<Note>\n- Alpha\n- Beta\n\nTail.\n</Note>', 'blankFirst').saved).toBe('<Note>\n- Alpha\n- Beta\n\nTail.\n</Note>');
    for (const body of ['- Alpha\n- Beta', '1. Alpha\n2. Beta', '> quoted', `- ${AR.first}\n- ${AR.second}`])
      for (const tag of ['Note', 'Tip', 'Card title="A"'])
        for (const page of placed(`<${tag}>\n${body}\n\nTail.\n</${tag.split(' ')[0]}>`)) expectStable(page, 'blankFirst');
  });
});
