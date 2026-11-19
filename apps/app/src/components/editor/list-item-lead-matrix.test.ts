// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { AllSelection } from '@tiptap/pm/state';
import { expect, it } from 'vitest';
import { markdownToEmit } from './editor-change-origin';
import { buildEditorExtensions, getMarkdown, seedMarkdown } from './tiptap-editor';

/*
 * Lists whose items open with a quote, heading, fence or nested list, or with nothing,
 * across marker widths and start numbers, saved as loaded and after every kind of edit an
 * item's empty first paragraph can receive (#604, #865). Each result has four checks:
 *
 * - fixed: the save, reloaded and saved twice more, stays the same bytes;
 * - document: the save reloads as the document it was written from, empty paragraphs and
 *   attributes included;
 * - text: no text is lost on that reload;
 * - source: unedited, the save has the block structure of the source.
 *
 * The fixture holds, for each result, a digest of main's save and reloaded document, and
 * main's checks. A result is `same` when its save and reload are main's, `correct` when it
 * differs and passes every check, and `sameFailure` when it differs but fails only checks
 * main fails too. Anything else is `worse`, and the gate is none, for every kind of edit.
 */

const FIXED = 1;
const DOCUMENT = 2;
const TEXT = 4;
const SOURCE = 8;
const ALL = FIXED | DOCUMENT | TEXT | SOURCE;
const RECORD = 9;

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/list-item-lead-main.json');

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
];

function pages(): string[] {
  const sources = new Set<string>(NAMED_PAGES);
  for (const [marker, next] of MARKERS)
    for (const block of BLOCKS) for (const form of FORMS) for (const context of CONTEXTS) sources.add(context(form(marker, block), next));
  return [...sources];
}

const open = () =>
  new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions(), editorProps: { handleScrollToSelection: () => true } });

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

function paste(editor: Editor, value: string, mime = 'text/plain'): void {
  const clipboardData = { files: [], types: [mime], getData: (type: string) => (type === mime ? value : '') };
  editor.view.dom.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), { clipboardData }));
}

const caret = (editor: Editor, positions: number[], which = 0) => editor.commands.setTextSelection(positions.at(which) as number);
const press =
  (key: string, which = 0) =>
  (editor: Editor, positions: number[]) => {
    caret(editor, positions, which);
    editor.commands.keyboardShortcut(key);
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

type Edit = (editor: Editor, positions: number[]) => unknown;

const LEAD_EDITS: Record<string, Edit> = {
  type: (editor, positions) => typed(editor, positions),
  typeLast: (editor, positions) => typed(editor, positions, -1),
  typeThenEnter: (editor, positions) => {
    typed(editor, positions);
    editor.commands.setTextSelection((positions[0] as number) + 2);
    editor.commands.keyboardShortcut('Enter');
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
  outdent: press('Shift-Tab', -1),
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
    editor.commands.keyboardShortcut('Backspace');
  },
  quoteInputRule: (editor, positions) => {
    caret(editor, positions);
    editor.view.dispatch(editor.state.tr.insertText('>'));
    const at = (positions[0] as number) + 1;
    editor.view.someProp('handleTextInput', (handler) => handler(editor.view, at, at, ' ', () => editor.state.tr.insertText(' ', at, at)));
  },
};

const PAGE_EDITS: Record<string, Edit> = {
  none: () => undefined,
  moveFirstBlockLast: (editor) => {
    const blocks: PMNode[] = [];
    editor.state.doc.forEach((node) => {
      blocks.push(node);
    });
    if (blocks.length > 1) {
      blocks.push(blocks.shift() as PMNode);
      editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, Fragment.fromArray(blocks)));
    }
  },
  copyAsTextToBlank: (editor) => {
    const { text } = copied(editor);
    seedMarkdown(editor, '');
    paste(editor, text);
  },
  copyAsHtmlToBlank: (editor) => {
    const { dom } = copied(editor);
    seedMarkdown(editor, '');
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

const digest = (text: string, length: number) => createHash('sha256').update(text).digest('hex').slice(0, length);

interface MatrixResult {
  id: string;
  edit: string;
  checks: number;
  outcome: string;
  saved: string;
}

const tick = () => new Promise<void>((done) => setTimeout(done, 0));

async function run(): Promise<MatrixResult[]> {
  const results: MatrixResult[] = [];
  let editor = open();
  let reader = open();
  let runs = 0;
  for (const source of pages()) {
    for (const [edit, apply] of [...Object.entries(PAGE_EDITS), ...Object.entries(LEAD_EDITS)]) {
      // Fresh editors now and then: each one keeps its load history until it is destroyed.
      if (++runs % 200 === 0) {
        editor.destroy();
        reader.destroy();
        await tick();
        editor = open();
        reader = open();
      }
      seedMarkdown(editor, source);
      const positions = leads(editor);
      if (edit in LEAD_EDITS && positions.length === 0) continue;
      apply(editor, positions);
      const saved = getMarkdown(editor);
      const written = JSON.stringify(shape(editor.state.doc));
      const text = editor.state.doc.textContent;
      seedMarkdown(reader, source);
      const loaded = getMarkdown(reader);
      // Nothing changed, or the change was undone: the page goes out as its source.
      if (edit === 'none' || edit === 'undoTyping') expect(markdownToEmit({ source, serialized: loaded }, saved)).toBe(source);
      seedMarkdown(reader, saved);
      const read = JSON.stringify(shape(reader.state.doc));
      const sameText = reader.state.doc.textContent === text;
      const again = getMarkdown(reader);
      seedMarkdown(reader, again);
      const fixed = again === saved && getMarkdown(reader) === saved;
      const sameSource = edit !== 'none' || blocks(editor, source) === blocks(editor, saved);
      results.push({
        id: `${JSON.stringify(source)} ${edit}`,
        edit,
        saved,
        outcome: digest(`${saved}\0${read}`, 8),
        checks: (fixed ? FIXED : 0) | (written === read ? DOCUMENT : 0) | (sameText ? TEXT : 0) | (sameSource ? SOURCE : 0),
      });
    }
  }
  editor.destroy();
  reader.destroy();
  return results;
}

/** What each kind of edit gives now, against main (see the note at the top). */
const EXPECTED_COUNTS: Record<string, { results: number; same: number; correct: number; sameFailure: number; worse: number }> = {
  none: { results: 173, same: 65, correct: 108, sameFailure: 0, worse: 0 },
  moveFirstBlockLast: { results: 173, same: 65, correct: 108, sameFailure: 0, worse: 0 },
  copyAsTextToBlank: { results: 173, same: 173, correct: 0, sameFailure: 0, worse: 0 },
  copyAsHtmlToBlank: { results: 173, same: 172, correct: 0, sameFailure: 1, worse: 0 },
  type: { results: 171, same: 63, correct: 108, sameFailure: 0, worse: 0 },
  typeLast: { results: 171, same: 63, correct: 108, sameFailure: 0, worse: 0 },
  typeThenEnter: { results: 171, same: 72, correct: 99, sameFailure: 0, worse: 0 },
  enter: { results: 171, same: 72, correct: 99, sameFailure: 0, worse: 0 },
  enterLast: { results: 171, same: 65, correct: 106, sameFailure: 0, worse: 0 },
  backspace: { results: 171, same: 171, correct: 0, sameFailure: 0, worse: 0 },
  backspaceLast: { results: 171, same: 171, correct: 0, sameFailure: 0, worse: 0 },
  delete: { results: 171, same: 171, correct: 0, sameFailure: 0, worse: 0 },
  deleteLast: { results: 171, same: 171, correct: 0, sameFailure: 0, worse: 0 },
  pasteText: { results: 171, same: 171, correct: 0, sameFailure: 0, worse: 0 },
  pasteMarkdown: { results: 171, same: 171, correct: 0, sameFailure: 0, worse: 0 },
  pasteHtml: { results: 171, same: 171, correct: 0, sameFailure: 0, worse: 0 },
  undoTyping: { results: 171, same: 63, correct: 108, sameFailure: 0, worse: 0 },
  redoTyping: { results: 171, same: 63, correct: 108, sameFailure: 0, worse: 0 },
  indent: { results: 171, same: 169, correct: 0, sameFailure: 2, worse: 0 },
  outdent: { results: 171, same: 169, correct: 0, sameFailure: 2, worse: 0 },
  toggleBulletList: { results: 171, same: 130, correct: 32, sameFailure: 9, worse: 0 },
  toggleOrderedList: { results: 171, same: 107, correct: 49, sameFailure: 15, worse: 0 },
  turnIntoHeading: { results: 171, same: 171, correct: 0, sameFailure: 0, worse: 0 },
  deleteToEnd: { results: 171, same: 171, correct: 0, sameFailure: 0, worse: 0 },
  typeOverToEnd: { results: 171, same: 169, correct: 2, sameFailure: 0, worse: 0 },
  typeThenBackspace: { results: 171, same: 126, correct: 45, sameFailure: 0, worse: 0 },
  quoteInputRule: { results: 171, same: 63, correct: 108, sameFailure: 0, worse: 0 },
};

it('no list item lead result is worse than main, for every kind of edit', { timeout: 600_000 }, async () => {
  const results = await run();
  const cases = digest(results.map(({ id }) => id).join('\n'), 16);
  if (process.env.WRITE_LIST_LEAD_MAIN) {
    const main = results.map(({ outcome, checks }) => outcome + checks.toString(16)).join('');
    writeFileSync(FIXTURE, `${JSON.stringify({ revision: process.env.WRITE_LIST_LEAD_MAIN, cases, count: results.length, main })}\n`);
    return;
  }
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: string; count: number; main: string };
  expect({ cases, count: results.length }).toEqual({ cases: fixture.cases, count: fixture.count });
  const counts: typeof EXPECTED_COUNTS = {};
  const worse: unknown[] = [];
  for (const [index, { id, edit, checks, outcome, saved }] of results.entries()) {
    const record = fixture.main.slice(index * RECORD, (index + 1) * RECORD);
    const mainChecks = Number.parseInt(record.slice(8), 16);
    counts[edit] ??= { results: 0, same: 0, correct: 0, sameFailure: 0, worse: 0 };
    const group = counts[edit];
    group.results++;
    if (record.slice(0, 8) === outcome) group.same++;
    else if (checks === ALL) group.correct++;
    else if ((mainChecks & ~checks) === 0) group.sameFailure++;
    else {
      group.worse++;
      worse.push({ id, checks, mainChecks, saved });
    }
  }
  expect(worse).toEqual([]);
  expect(counts).toEqual(EXPECTED_COUNTS);
});
