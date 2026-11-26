// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Editor } from '@tiptap/core';
import { undoDepth } from '@tiptap/pm/history';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { AllSelection } from '@tiptap/pm/state';
import { expect, it } from 'vitest';
import { textChange } from './__fixtures__/list-item-leads';
import { markdownToEmit } from './editor-change-origin';

/*
 * Lists whose items open with a quote, heading, fence or nested list, or with nothing,
 * across marker widths and start numbers, saved as loaded and after every kind of edit an
 * item's empty first paragraph can receive (#604, #865), against main. Each result has
 * four checks on its save:
 * - fixed: the save, reloaded and saved twice more, stays the same bytes;
 * - document: the save reloads as the document it was written from;
 * - text: the reload has the document's text; how many characters it lost and added
 *   (textChange) are kept too, and a save that fails this check as main's does must lose
 *   and add no more than main's;
 * - source: unedited, the save has the block structure of the source;
 * and four on the edit itself, which must be main's (#887's review):
 * - target: the document's text after the edit;
 * - caret: the text before the caret after the edit;
 * - undo: the undo depth after the edit;
 * - draft: whether the edit changed the document, so the draft changed and autosave runs.
 *
 * A save is `same` as main's, `correct` when it differs and passes every check, or
 * `sameFailure` when it fails only checks main fails too. Anything else is `worse`, and
 * the gate is none, for every kind of edit. Edits that differ from main's are listed by
 * kind in EDIT_EXCEPTIONS, each with why.
 *
 * Main's results come from running main's editor code: list-item-leads-main.generate.mjs.
 */

const FIXED = 1;
const DOCUMENT = 2;
const TEXT = 4;
const SOURCE = 8;
const ALL = FIXED | DOCUMENT | TEXT | SOURCE;

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/list-item-lead-matrix-main.json');

const indent = (text: string, by: number) =>
  text
    .split('\n')
    .map((line, index) => (index && line ? ' '.repeat(by) + line : line))
    .join('\n');

const MARKERS = [
  ['-', '-'],
  ['1.', '2.'],
  ['3.', '4.'],
  ['10)', '11)'],
] as const;
const BLOCKS = ['> Alpha', '## Heading', '```js\nx\n```', '- Child', '10) Child\n11) Next', ''];
const FORMS = [
  (marker: string, block: string) => (block ? `${marker} ${indent(block, marker.length + 1)}` : marker),
  (marker: string, block: string) => (block ? `${marker}\n${' '.repeat(marker.length + 1)}${indent(block, marker.length + 1)}` : `${marker} `),
];
const CONTEXTS = [
  (item: string) => `${item}\n\nOutro.`,
  (item: string, next: string) => `${item}\n${next} Sibling`,
  (item: string, next: string) => `${item}\n${next} > Beta`,
];
const NAMED_PAGES = [
  '- > a',
  '- # a',
  '- - a',
  '- 2. a',
  '1. > a\n2. > b',
  '1. > a\n2. b',
  '- > a\n  - b',
  '- > a\n\n  2. b',
  '- a\n  - > b',
  '- a\n  - # b',
  '1. a\n   - > b\n2. c',
  '1. a\n   - 2. b\n2. c',
  '- > a\n\n* b',
  '1. > a\n\n1) b',
  '- # a\n- - b',
  '1. # a\n2. 1) b',
  '2. a\n   - 1) b',
  '1. -\n   - x',
  '-\n- > a',
  '- > a\n-',
  '- > - # a\n- > - # b',
  '> - > a\n> - # b',
  '- > [!NOTE]\n  > b',
  '- > a\n\n  <Card title="X">text</Card>',
  '-\t> العربية\r\n-\t## עברית\r\n\r\nخاتمة\r\n',
  '1.\r\n   > العربية\r\n\r\n2.\r\n   # עברית\r\n',
  '- <p data-md-item-lead>Keep</p>\n\nTail',
  '<ul><li><p data-md-item-lead="inline">KEEP ME</p><p>next</p></li></ul>',
  '- > a\n\nX\n\n1. # b',
  // #887's review rows.
  '10)\n    > Alpha\n\nOutro.',
  '10)\n    ## Heading\n\nOutro.',
  '- > Alpha\n- > Beta',
  '- 10) Child\n  11) Next\n- Sibling\n\nOutro.',
  '- > a\n\nFirst\n\nMiddle\n\nLast\n\n1. > b',
  '- # abcdef',
  '- > /h2 Keep',
  '- > a\n\nParagraph',
  'A\n\nB\n\nC\n\nD\n\n- > a',
  'Intro\n\nMiddle\n\nOther\n\n- > a',
];

function pages(): string[] {
  const sources = new Set<string>(NAMED_PAGES);
  for (const [marker, next] of MARKERS)
    for (const block of BLOCKS) for (const form of FORMS) for (const context of CONTEXTS) sources.add(context(form(marker, block), next));
  return [...sources];
}

type EditorModule = Pick<typeof import('./tiptap-editor'), 'buildEditorExtensions' | 'getMarkdown' | 'seedMarkdown'>;

/** The document with every node and attribute, less the source text kept for saving. */
function shape(node: PMNode, top = true): unknown {
  if (node.isText) return [node.text, node.marks.map((mark) => mark.toJSON())];
  const attributes = Object.entries(node.attrs).filter(
    ([name, value]) => !name.startsWith('source') && name !== 'tight' && value !== null && value !== undefined,
  );
  const children: unknown[] = [];
  node.forEach((child, _offset, index) => {
    // The editor keeps an empty paragraph after a page's last block; no save holds it.
    if (!(top && index === node.childCount - 1 && child.type.name === 'paragraph' && child.content.size === 0)) children.push(shape(child, false));
  });
  return [node.type.name, attributes, children];
}

/** Every empty first paragraph of a list item, in document order. */
function leads(editor: Editor): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos, parent) => {
    if (node.type.name === 'paragraph' && !node.content.size && parent?.type.name === 'listItem' && parent.firstChild === node)
      positions.push(pos + 1);
  });
  return positions;
}

/** Where `text` starts in the document, or -1. */
function find(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    const at = node.isText ? (node.text ?? '').indexOf(text) : -1;
    if (found === -1 && at !== -1) found = pos + at;
  });
  return found;
}

function paste(editor: Editor, value: string, mime = 'text/plain'): void {
  const clipboardData = { files: [], types: [mime], getData: (type: string) => (type === mime ? value : '') };
  editor.view.dom.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), { clipboardData }));
}

/** A key pressed as a writer presses it: a keydown on the editor. */
function key(editor: Editor, name: string, shiftKey = false): void {
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }));
}

const caret = (editor: Editor, positions: number[], which = 0) => editor.commands.setTextSelection(positions.at(which) as number);
const press =
  (name: string, which = 0, shiftKey = false) =>
  (editor: Editor, positions: number[]) => {
    caret(editor, positions, which);
    key(editor, name, shiftKey);
  };
const typed = (editor: Editor, positions: number[], which = 0) => {
  caret(editor, positions, which);
  editor.commands.insertContent('Typed');
};
const toEnd = (editor: Editor, positions: number[]) =>
  editor.commands.setTextSelection({ from: positions[0] as number, to: editor.state.doc.content.size - 1 });
const copied = (editor: Editor) => {
  editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
  return editor.view.serializeForClipboard(editor.state.selection.content());
};

type Edit = (editor: Editor, positions: number[], seed: (markdown: string) => void) => unknown;

const LEAD_EDITS: Record<string, Edit> = {
  type: (editor, positions) => typed(editor, positions),
  typeLast: (editor, positions) => typed(editor, positions, -1),
  typeThenEnter: (editor, positions) => {
    typed(editor, positions);
    editor.commands.setTextSelection((positions[0] as number) + 2);
    key(editor, 'Enter');
  },
  enter: press('Enter'),
  enterLast: press('Enter', -1),
  backspace: press('Backspace'),
  backspaceLast: press('Backspace', -1),
  delete: press('Delete'),
  deleteLast: press('Delete', -1),
  pasteText: (editor, positions) => {
    caret(editor, positions);
    paste(editor, 'Pasted');
  },
  pasteMarkdown: (editor, positions) => {
    caret(editor, positions);
    paste(editor, '> Paste\n\n- new');
  },
  pasteHtml: (editor, positions) => {
    caret(editor, positions);
    paste(editor, '<blockquote><p>Paste</p></blockquote><ul><li>new</li></ul>', 'text/html');
  },
  pasteComposing: (editor, positions) => {
    caret(editor, positions);
    const input = (editor.view as unknown as { input: { composing: boolean } }).input;
    input.composing = true;
    paste(editor, 'Pasted');
    input.composing = false;
  },
  undoTyping: (editor, positions) => {
    typed(editor, positions);
    editor.commands.undo();
  },
  redoTyping: (editor, positions) => {
    typed(editor, positions);
    editor.commands.undo();
    editor.commands.redo();
  },
  indent: press('Tab', -1),
  outdent: press('Tab', -1, true),
  sink: (editor, positions) => {
    caret(editor, positions);
    editor.commands.sinkListItem('listItem');
  },
  toggleBulletList: (editor, positions) => {
    caret(editor, positions);
    editor.commands.toggleBulletList();
  },
  toggleOrderedList: (editor, positions) => {
    caret(editor, positions);
    editor.commands.toggleOrderedList();
  },
  turnIntoHeading: (editor, positions) => {
    caret(editor, positions);
    editor.commands.toggleHeading({ level: 2 });
  },
  deleteToEnd: (editor, positions) => {
    toEnd(editor, positions);
    editor.commands.deleteSelection();
  },
  typeOverToEnd: (editor, positions) => {
    toEnd(editor, positions);
    editor.commands.insertContent('Typed');
  },
  typeThenBackspace: (editor, positions) => {
    typed(editor, positions);
    editor.commands.setTextSelection(positions[0] as number);
    key(editor, 'Backspace');
  },
  quoteInputRule: (editor, positions) => {
    caret(editor, positions);
    editor.view.dispatch(editor.state.tr.insertText('>'));
    const at = (positions[0] as number) + 1;
    editor.view.someProp('handleTextInput', (handler) => handler(editor.view, at, at, ' ', () => editor.state.tr.insertText(' ', at, at)));
  },
};

/** Edits of the page around its leads, by the text they target (#887's review rows). */
const TEXT_EDITS: Record<string, { text: string; edit: (editor: Editor, at: number) => unknown }> = {
  deleteThreeLetters: { text: 'abc', edit: (editor, at) => editor.commands.deleteRange({ from: at, to: at + 3 }) },
  slashHeading: {
    text: '/h2 ',
    edit: (editor, at) =>
      editor
        .chain()
        .deleteRange({ from: at, to: at + 4 })
        .setNode('heading', { level: 2 })
        .run(),
  },
  backspaceThenType: {
    text: 'Paragraph',
    edit: (editor, at) => {
      editor.commands.setTextSelection(at);
      key(editor, 'Backspace');
      editor.commands.insertContent('X');
    },
  },
  pasteInWord: {
    text: 'Paragraph',
    edit: (editor, at) => {
      editor.commands.setTextSelection(at + 4);
      paste(editor, 'Word');
    },
  },
  dropAfterFirst: {
    text: 'A',
    edit: (editor, at) => editor.view.dispatch(editor.state.tr.insertText('Dropped', at + 1).setMeta('uiEvent', 'drop')),
  },
  backspaceAtMiddle: {
    text: 'Middle',
    edit: (editor, at) => {
      editor.commands.setTextSelection(at);
      key(editor, 'Backspace');
    },
  },
  draftVideoThenToggle: {
    text: 'Middle',
    edit: (editor, at) => {
      editor.commands.insertContentAt(at - 1, { type: 'videoEmbed', attrs: { src: '', title: 'Unsaved title' } });
      const [lead] = leads(editor);
      if (lead !== undefined) editor.commands.setTextSelection(lead);
      editor.commands.toggleOrderedList();
    },
  },
};

const PAGE_EDITS: Record<string, Edit> = {
  none: () => undefined,
  // The page's own blocks: the empty paragraph the editor keeps after the last block
  // stays last, as a writer cannot move it.
  moveFirstBlockLast: (editor) => {
    const blocks: PMNode[] = [];
    editor.state.doc.forEach((node) => {
      blocks.push(node);
    });
    const trailing = blocks.at(-1)?.type.name === 'paragraph' && blocks.at(-1)?.content.size === 0 ? blocks.pop() : undefined;
    if (blocks.length > 1) {
      blocks.push(blocks.shift() as PMNode);
      if (trailing) blocks.push(trailing);
      editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, Fragment.fromArray(blocks)));
    }
  },
  copyAsTextToBlank: (editor, _positions, seed) => {
    const { text } = copied(editor);
    seed('');
    paste(editor, text);
  },
  copyAsHtmlToBlank: (editor, _positions, seed) => {
    const { dom } = copied(editor);
    seed('');
    paste(editor, dom.innerHTML, 'text/html');
  },
};

interface MarkdownItToken {
  type: string;
  tag: string;
  nesting: number;
  content: string;
  attrGet(name: string): string | null;
}

/** The blocks markdown-it reads from `source`, without the editor's empty paragraphs. */
function blocks(editor: Editor, source: string): string {
  const { md } = (editor.storage as unknown as { markdown: { parser: { md: { parse(text: string, env: object): MarkdownItToken[] } } } }).markdown
    .parser;
  const root: unknown[] = [];
  const stack: unknown[][] = [root];
  for (const token of md.parse(source.replaceAll('\r\n', '\n'), {})) {
    const top = stack.at(-1) as unknown[];
    if (token.type === 'paragraph_open' || token.type === 'paragraph_close') continue;
    if (token.type === 'inline') {
      if (token.content) top.push(token.content.replace(/\s*\n\s*/g, ' '));
    } else if (token.nesting === 1) {
      const node: unknown[] = [token.tag, token.type === 'ordered_list_open' ? (token.attrGet('start') ?? '1') : ''];
      top.push(node);
      stack.push(node);
    } else if (token.nesting === -1) stack.pop();
    else top.push([token.type, token.content]);
  }
  return JSON.stringify(root);
}

const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 8);

/** One result: its id, the save's digest and checks, and the edit's target, caret, undo
 *  depth and draft change; null where the page has no lead or text to edit. */
interface MatrixResult {
  id: string;
  edit: string;
  saved: string;
  checks: number;
  lost: number;
  added: number;
  interaction: string;
}

const tick = () => new Promise<void>((done) => setTimeout(done, 0));

async function run(module: EditorModule): Promise<Array<MatrixResult | null>> {
  const open = () =>
    new Editor({
      element: document.createElement('div'),
      extensions: module.buildEditorExtensions(),
      editorProps: { handleScrollToSelection: () => true },
    });
  const results: Array<MatrixResult | null> = [];
  let editor = open();
  let reader = open();
  let runs = 0;
  const edits: Array<[string, Edit | null, string | null]> = [
    ...Object.entries(PAGE_EDITS).map(([name, edit]): [string, Edit, null] => [name, edit, null]),
    ...Object.entries(LEAD_EDITS).map(([name, edit]): [string, Edit, null] => [name, edit, null]),
    ...Object.keys(TEXT_EDITS).map((name): [string, null, string] => [name, null, name]),
  ];
  for (const source of pages()) {
    for (const [name, apply, textEdit] of edits) {
      // Fresh editors now and then: each one keeps its load history until it is destroyed.
      if (++runs % 200 === 0) {
        editor.destroy();
        reader.destroy();
        await tick();
        editor = open();
        reader = open();
      }
      const id = `${JSON.stringify(source)} ${name}`;
      module.seedMarkdown(editor, source);
      const positions = leads(editor);
      const target = textEdit ? find(editor, (TEXT_EDITS[textEdit] as { text: string }).text) : 0;
      if ((name in LEAD_EDITS && positions.length === 0) || target === -1) {
        results.push(null);
        continue;
      }
      let changed = false;
      const listener = ({ transaction }: { transaction: { docChanged: boolean } }) => {
        changed ||= transaction.docChanged;
      };
      editor.on('transaction', listener);
      if (textEdit) (TEXT_EDITS[textEdit] as { edit: (editor: Editor, at: number) => unknown }).edit(editor, target);
      else (apply as Edit)(editor, positions, (markdown) => module.seedMarkdown(editor, markdown));
      editor.off('transaction', listener);
      const interaction = [
        digest(editor.state.doc.textContent),
        digest(editor.state.doc.textBetween(0, editor.state.selection.from, '')),
        undoDepth(editor.state),
        changed ? 1 : 0,
      ].join(':');
      const saved = module.getMarkdown(editor);
      const written = JSON.stringify(shape(editor.state.doc));
      const text = editor.state.doc.textContent;
      module.seedMarkdown(reader, source);
      const loaded = module.getMarkdown(reader);
      // Nothing changed, or the change was undone: the page goes out as its source.
      if (name === 'none' || name === 'undoTyping') expect(markdownToEmit({ source, serialized: loaded }, saved)).toBe(source);
      module.seedMarkdown(reader, saved);
      const read = JSON.stringify(shape(reader.state.doc));
      const sameText = reader.state.doc.textContent === text;
      const { lost, added } = textChange(text, reader.state.doc.textContent);
      const again = module.getMarkdown(reader);
      module.seedMarkdown(reader, again);
      const fixed = again === saved && module.getMarkdown(reader) === saved;
      const sameSource = name !== 'none' || blocks(editor, source) === blocks(editor, saved);
      results.push({
        id,
        edit: name,
        saved: digest(`${saved}\0${read}`),
        checks: (fixed ? FIXED : 0) | (written === read ? DOCUMENT : 0) | (sameText ? TEXT : 0) | (sameSource ? SOURCE : 0),
        lost,
        added,
        interaction,
      });
    }
  }
  editor.destroy();
  reader.destroy();
  return results;
}

const encode = (result: MatrixResult | null) =>
  result ? `${result.saved} ${result.checks} ${result.interaction} ${result.lost} ${result.added}` : '-';

const baselineDir = process.env.LIST_ITEM_LEADS_BASELINE_DIR;

it.runIf(baselineDir)(
  'records main’s results for the list item lead matrix',
  async () => {
    const module = (await import(/* @vite-ignore */ pathToFileURL(join(baselineDir as string, 'tiptap-editor.tsx')).href)) as EditorModule;
    const results = (await run(module)).map(encode);
    writeFileSync(
      FIXTURE,
      `${JSON.stringify({ revision: process.env.LIST_ITEM_LEADS_BASELINE_REVISION ?? '', pages: pages().length, results }, null, 2)}\n`,
    );
  },
  900_000,
);

type Field = 'target' | 'caret' | 'undo' | 'draft';
const FIELDS: readonly Field[] = ['target', 'caret', 'undo', 'draft'];

/**
 * Edits whose target, caret, undo depth or draft change differ from main's, by kind: how
 * many results do, which of those may differ, and why. Each such result must also pass
 * every save check.
 */
const EDIT_EXCEPTIONS: Record<string, { count: number; fields: readonly Field[]; why: string }> = {
  moveFirstBlockLast: {
    count: 138,
    fields: FIELDS,
    why: 'main had moved each lead block out of its list, so the page’s first block is another block',
  },
  copyAsTextToBlank: {
    count: 40,
    fields: ['target', 'caret'],
    why: 'the copied text is the page’s Markdown with each block in its item; main’s had the block moved out',
  },
  turnIntoHeading: {
    count: 123,
    fields: ['undo', 'draft'],
    why: 'an item’s first block must be a paragraph, so a lead before a block cannot become a heading, as main refuses for the first paragraph of any item holding more blocks (`- a` then `> q`); main turned its emptied item into one',
  },
  indent: { count: 39, fields: ['undo', 'draft'], why: 'Tab indents the item, which is still a list item; main refused (no change)' },
  outdent: { count: 5, fields: ['undo', 'draft'], why: 'Shift-Tab lifts the item, which is still nested; main refused (no change)' },
  toggleBulletList: { count: 5, fields: ['undo', 'draft'], why: 'the toggle applies to the item, which is still nested; main refused (no change)' },
};

/**
 * Text pasted from a tight item whose text is followed by a nested list gets a trailing
 * hard break, which no save holds, so the reload is not the pasted document. Main's paste
 * does the same for the same item without a lead (`- a` then `  - b`, list-item-leads.test.ts).
 */
const PASTED_HARD_BREAK = ['"- a\\n  - > b" copyAsTextToBlank', '"1. a\\n   - > b\\n2. c" copyAsTextToBlank'];

type Counts = { results: number; same: number; correct: number; sameFailure: number; hardBreak?: number };

/** What each kind of edit's save gives now, against main (see the note at the top). */
const EXPECTED_COUNTS: Record<string, Counts> = {
  none: { results: 180, same: 32, correct: 146, sameFailure: 2 },
  moveFirstBlockLast: { results: 180, same: 32, correct: 148, sameFailure: 0 },
  copyAsTextToBlank: { results: 180, same: 34, correct: 141, sameFailure: 3, hardBreak: 2 },
  copyAsHtmlToBlank: { results: 180, same: 56, correct: 124, sameFailure: 0 },
  type: { results: 178, same: 16, correct: 162, sameFailure: 0 },
  typeLast: { results: 178, same: 16, correct: 162, sameFailure: 0 },
  typeThenEnter: { results: 178, same: 16, correct: 162, sameFailure: 0 },
  enter: { results: 178, same: 32, correct: 137, sameFailure: 9 },
  enterLast: { results: 178, same: 32, correct: 144, sameFailure: 2 },
  backspace: { results: 178, same: 88, correct: 5, sameFailure: 85 },
  backspaceLast: { results: 178, same: 103, correct: 6, sameFailure: 69 },
  delete: { results: 178, same: 32, correct: 146, sameFailure: 0 },
  deleteLast: { results: 178, same: 32, correct: 146, sameFailure: 0 },
  pasteText: { results: 178, same: 16, correct: 162, sameFailure: 0 },
  pasteMarkdown: { results: 178, same: 16, correct: 162, sameFailure: 0 },
  pasteHtml: { results: 178, same: 16, correct: 162, sameFailure: 0 },
  pasteComposing: { results: 178, same: 32, correct: 146, sameFailure: 0 },
  undoTyping: { results: 178, same: 32, correct: 146, sameFailure: 0 },
  redoTyping: { results: 178, same: 16, correct: 162, sameFailure: 0 },
  indent: { results: 178, same: 32, correct: 138, sameFailure: 8 },
  outdent: { results: 178, same: 103, correct: 6, sameFailure: 69 },
  sink: { results: 178, same: 32, correct: 146, sameFailure: 0 },
  toggleBulletList: { results: 178, same: 62, correct: 95, sameFailure: 21 },
  toggleOrderedList: { results: 178, same: 58, correct: 56, sameFailure: 64 },
  turnIntoHeading: { results: 178, same: 32, correct: 146, sameFailure: 0 },
  deleteToEnd: { results: 178, same: 178, correct: 0, sameFailure: 0 },
  typeOverToEnd: { results: 178, same: 176, correct: 2, sameFailure: 0 },
  typeThenBackspace: { results: 178, same: 88, correct: 90, sameFailure: 0 },
  quoteInputRule: { results: 178, same: 16, correct: 162, sameFailure: 0 },
  dropAfterFirst: { results: 25, same: 0, correct: 25, sameFailure: 0 },
  backspaceAtMiddle: { results: 2, same: 0, correct: 2, sameFailure: 0 },
  draftVideoThenToggle: { results: 2, same: 0, correct: 0, sameFailure: 2 },
  deleteThreeLetters: { results: 1, same: 0, correct: 1, sameFailure: 0 },
  slashHeading: { results: 1, same: 0, correct: 1, sameFailure: 0 },
  backspaceThenType: { results: 1, same: 0, correct: 1, sameFailure: 0 },
  pasteInWord: { results: 1, same: 0, correct: 1, sameFailure: 0 },
};

it.skipIf(baselineDir)(
  'no list item lead result is worse than main’s, in its save or in the edit itself',
  async () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { pages: number; results: string[] };
    const results = await run(await import('./tiptap-editor'));
    expect({ pages: pages().length, count: results.length }).toEqual({ pages: fixture.pages, count: fixture.results.length });
    const counts: Record<string, Counts> = {};
    const interactions: Record<string, number> = {};
    const worse: unknown[] = [];
    for (const [index, result] of results.entries()) {
      const main = fixture.results[index] as string;
      if (!result) {
        // Main had a lead or the target text wherever this page has one.
        if (main !== '-') worse.push({ index, main, now: null });
        continue;
      }
      counts[result.edit] ??= { results: 0, same: 0, correct: 0, sameFailure: 0 };
      const group = counts[result.edit] as Counts;
      group.results++;
      if (main === '-') {
        // No lead on main to edit: the result must pass every check.
        if (result.checks === ALL) group.correct++;
        else worse.push({ id: result.id, checks: result.checks, main: null });
        continue;
      }
      const [savedMain, checksMain, interactionMain, lostMain, addedMain] = main.split(' ') as string[] as [string, string, string, string?, string?];
      const mainChecks = Number(checksMain);
      // A record without a count would compare as never worse.
      if (!Number.isInteger(Number(lostMain)) || !Number.isInteger(Number(addedMain)))
        throw new Error(`Main's record for ${result.id} has no text counts: re-record the fixture`);
      const moreText = result.lost > Number(lostMain) || result.added > Number(addedMain);
      const failedChecks = mainChecks & ~result.checks;
      // The same save and reload as main's counts as the same only when no check main passes now fails: the
      // document it was written from can differ (an edit leaving an empty paragraph no save holds).
      if (!moreText && failedChecks === 0) {
        if (savedMain === result.saved) group.same++;
        else if (result.checks === ALL) group.correct++;
        else group.sameFailure++;
      } else if (!moreText && PASTED_HARD_BREAK.includes(result.id) && failedChecks === DOCUMENT) group.hardBreak = (group.hardBreak ?? 0) + 1;
      else worse.push({ id: result.id, checks: result.checks, mainChecks, lost: result.lost, added: result.added, lostMain, addedMain });
      if (interactionMain !== result.interaction) {
        interactions[result.edit] = (interactions[result.edit] ?? 0) + 1;
        const before = interactionMain.split(':');
        const after = result.interaction.split(':');
        const allowed = EDIT_EXCEPTIONS[result.edit]?.fields ?? [];
        const unexplained = FIELDS.filter((field, at) => before[at] !== after[at] && !allowed.includes(field));
        if (result.checks !== ALL || unexplained.length > 0)
          worse.push({ id: result.id, interaction: result.interaction, interactionMain, checks: result.checks });
      }
    }
    const checked = Object.values(counts).reduce((total, group) => total + group.results, 0);
    console.info(`[list-item-lead-matrix] ${results.length} page/edit rows, ${checked} applicable edits, ${worse.length} regressions`);
    expect(worse, JSON.stringify(worse.slice(0, 20))).toEqual([]);
    expect(interactions).toEqual(Object.fromEntries(Object.entries(EDIT_EXCEPTIONS).map(([edit, { count }]) => [edit, count])));
    expect(counts, JSON.stringify(counts)).toEqual(EXPECTED_COUNTS);
  },
  900_000,
);
