// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { expect, it } from 'vitest';
import { markdownToEmit } from './editor-change-origin';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * Lists whose items open with a quote, heading, fence or nested list, or with nothing,
 * across marker widths and start numbers, saved as loaded and after typing and pressing
 * Enter in an item's empty first paragraph (#604, #865). Each result holds four checks:
 *
 * - fixed: the save, reloaded and saved twice more, stays the same bytes;
 * - document: the save reloads as the document it was written from;
 * - text: no text is lost on that reload;
 * - source: unedited, the save has the block structure of the source.
 *
 * The fixture holds main's checks. No result may lose one main passed.
 */

const FIXED = 1;
const DOCUMENT = 2;
const TEXT = 4;
const SOURCE = 8;
const ALL = FIXED | DOCUMENT | TEXT | SOURCE;

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
  ['100.', '101.'],
] as const;
const BLOCKS = ['> Alpha', '## Heading', '```js\nx\n```', '- Child', '1. Child\n2. Next', '10) Child\n11) Next', '- > Deep', ''];
const FORMS = [
  (marker: string, block: string) => (block ? `${marker} ${indent(block, marker.length + 1)}` : marker),
  (marker: string, block: string) => (block ? `${marker}\n${' '.repeat(marker.length + 1)}${indent(block, marker.length + 1)}` : `${marker} `),
];
const CONTEXTS = [
  (item: string) => `${item}\n\nOutro.`,
  (item: string, next: string) => `${item}\n${next} Sibling`,
  (item: string, next: string) => `${item}\n\n${next} Sibling\n\nOutro.`,
];
const NARROW_CONTEXTS = [(item: string, next: string) => `${item}\n${next} > Beta`, (item: string) => `- Top\n${indent(`  ${item}`, 2)}`];

function pages(): string[] {
  const sources = new Set<string>();
  for (const [marker, next] of MARKERS)
    for (const block of BLOCKS)
      for (const form of FORMS) {
        const item = form(marker, block);
        for (const context of CONTEXTS) sources.add(context(item, next));
        if (marker === '-' || marker === '10)') for (const context of NARROW_CONTEXTS) sources.add(context(item, next));
      }
  return [...sources];
}

const open = () =>
  new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions(), editorProps: { handleScrollToSelection: () => true } });
const load = (editor: Editor, source: string) => editor.commands.setContent(source, { emitUpdate: false });

function shape(node: PMNode): unknown {
  if (node.type.name === 'paragraph' && node.content.size === 0) return null;
  if (node.isText) return node.text;
  const children: unknown[] = [];
  node.forEach((child) => {
    const value = shape(child);
    if (value !== null) children.push(value);
  });
  return [node.type.name, node.attrs.start, node.attrs.level, node.type.name === 'codeBlock' ? node.textContent : null, children];
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

const typeAt = (editor: Editor, at: number) => editor.view.dispatch(editor.state.tr.insertText('Typed', at));
function enterAt(editor: Editor, at: number): void {
  editor.commands.setTextSelection(at);
  editor.commands.keyboardShortcut('Enter');
}

const EDITS: Record<string, (editor: Editor, positions: number[]) => void> = {
  none: () => undefined,
  type: (editor, [first]) => typeAt(editor, first as number),
  enter: (editor, [first]) => enterAt(editor, first as number),
  typeThenEnter: (editor, [first]) => {
    typeAt(editor, first as number);
    enterAt(editor, (first as number) + 5);
  },
  typeLast: (editor, positions) => typeAt(editor, positions.at(-1) as number),
  enterLast: (editor, positions) => enterAt(editor, positions.at(-1) as number),
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
  for (const token of md.parse(source, {})) {
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

interface MatrixResult {
  id: string;
  checks: number;
  saved: string;
}

function run(): MatrixResult[] {
  const results: MatrixResult[] = [];
  let editor = open();
  let reader = open();
  for (const [index, source] of pages().entries()) {
    // A fresh pair now and then: each load adds to an editor's undo history.
    if (index % 40 === 39) {
      editor.destroy();
      reader.destroy();
      editor = open();
      reader = open();
    }
    for (const [name, edit] of Object.entries(EDITS)) {
      load(editor, source);
      const positions = leads(editor);
      if (name !== 'none' && positions.length === 0) continue;
      edit(editor, positions);
      const saved = getMarkdown(editor);
      load(reader, saved);
      const again = getMarkdown(reader);
      const sameDocument = JSON.stringify(shape(reader.state.doc)) === JSON.stringify(shape(editor.state.doc));
      const sameText = reader.state.doc.textContent === editor.state.doc.textContent;
      load(reader, again);
      const fixed = again === saved && getMarkdown(reader) === saved;
      const sameSource = name !== 'none' || blocks(editor, source) === blocks(editor, saved);
      results.push({
        id: `${JSON.stringify(source)} ${name}`,
        saved,
        checks: (fixed ? FIXED : 0) | (sameDocument ? DOCUMENT : 0) | (sameText ? TEXT : 0) | (sameSource ? SOURCE : 0),
      });
      // An unedited page is emitted as its source, byte for byte.
      if (name === 'none') expect(markdownToEmit({ source, serialized: saved }, getMarkdown(editor))).toBe(source);
    }
  }
  editor.destroy();
  reader.destroy();
  return results;
}

const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

it('no list item lead shape is worse than main', { timeout: 600_000 }, () => {
  const results = run();
  const cases = digest(results.map(({ id }) => id).join('\n'));
  const checks = results.map((result) => result.checks.toString(16)).join('');
  if (process.env.WRITE_LIST_LEAD_MAIN) {
    writeFileSync(FIXTURE, `${JSON.stringify({ revision: process.env.WRITE_LIST_LEAD_MAIN, cases, count: results.length, checks })}\n`);
    return;
  }
  const main = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: string; count: number; checks: string };
  expect({ cases, count: results.length }).toEqual({ cases: main.cases, count: main.count });
  const worse = results.flatMap(({ id, checks: head, saved }, index) => {
    const before = Number.parseInt(main.checks[index] as string, 16);
    return before & ~head ? [{ id, main: before, head, saved }] : [];
  });
  expect(worse).toEqual([]);
  const passing = (values: number[]) => values.filter((value) => value === ALL).length;
  const mainPassing = passing(Array.from(main.checks, (value) => Number.parseInt(value, 16)));
  expect(passing(results.map((result) => result.checks))).toBeGreaterThan(mainPassing);
});
