// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { expect, it } from 'vitest';
import { LIST_ITEM_LEAD_PAGES, LIST_ITEM_LEAD_TEXT_KEPT } from './__fixtures__/list-item-leads';
import { applyCorpusEdits, type DifferentialEditor, serializerCorpus } from './__fixtures__/serializer-corpus';

/*
 * The serializer corpus pages that load or save differently with list item leads (#604,
 * #865), against main. A list item led by a quote, heading or list kept that block on
 * main only by moving it out of the list, so every page holding one differs: its nodes
 * (the block stays in its item) and its saves. They are named (LIST_ITEM_LEAD_PAGES) and
 * counted, and the other differentials leave exactly these pages to this test.
 *
 * The fixture holds, for each page, main's nodes and saves (hashed), and how main's
 * saves, unedited and after the corpus edits, did on four checks:
 * - fixed: the save, reloaded and saved twice more, stays the same bytes;
 * - document: the save reloads as the document it was written from;
 * - text: no text is lost on that reload, and how many characters are;
 * - source: unedited, the save has the block structure markdown-it reads from the source.
 * Each named page passes every check main passes, and loses no more text than main.
 * One page trades a check (LIST_ITEM_LEAD_TEXT_KEPT): main saves it to a fixed point only
 * after losing text; it now loses far less (none unedited), and is not yet a fixed point.
 *
 * Record with `node apps/app/src/components/editor/__fixtures__/list-item-leads-main.generate.mjs`.
 */

const FIXED = 1;
const DOCUMENT = 2;
const TEXT = 4;
const SOURCE = 8;
const ALL = FIXED | DOCUMENT | TEXT | SOURCE;

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/list-item-leads-main.json');
const cases = serializerCorpus();
const sources = createHash('sha256')
  .update(cases.map(({ source, edits }) => `${source}\0${JSON.stringify(edits)}`).join('\0\0'))
  .digest('hex')
  .slice(0, 16);
const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12);

type EditorModule = Pick<typeof import('./tiptap-editor'), 'buildEditorExtensions' | 'getMarkdown'>;

interface SaveRecord {
  hash: string;
  checks: number;
  lost: number;
}
interface PageRecord {
  nodes: string;
  plain: SaveRecord;
  edited: SaveRecord;
}

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

interface MarkdownItToken {
  type: string;
  tag: string;
  nesting: number;
  content: string;
  attrGet(name: string): string | null;
}

/** The blocks markdown-it reads from `source`, with their text. */
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

/** Characters of `before` that `after` no longer has, counted as a multiset. */
function lostCharacters(before: string, after: string): number {
  const counts = new Map<string, number>();
  for (const character of before) counts.set(character, (counts.get(character) ?? 0) + 1);
  for (const character of after) counts.set(character, (counts.get(character) ?? 0) - 1);
  let lost = 0;
  for (const count of counts.values()) if (count > 0) lost += count;
  return lost;
}

function record(module: EditorModule): PageRecord[] {
  const editor = new Editor({ element: document.createElement('div'), extensions: module.buildEditorExtensions() });
  const reader = new Editor({ element: document.createElement('div'), extensions: module.buildEditorExtensions() });
  const load = (target: Editor, markdown: string) => target.commands.setContent(markdown, { emitUpdate: false });
  const check = (source: string, edited: boolean): SaveRecord => {
    const saved = module.getMarkdown(editor);
    const written = JSON.stringify(shape(editor.state.doc));
    const text = editor.state.doc.textContent;
    load(reader, saved);
    const read = JSON.stringify(shape(reader.state.doc));
    const sameText = reader.state.doc.textContent === text;
    const lost = lostCharacters(text, reader.state.doc.textContent);
    const again = module.getMarkdown(reader);
    load(reader, again);
    const fixed = again === saved && module.getMarkdown(reader) === saved;
    const sameSource = edited || blocks(editor, source) === blocks(editor, saved);
    const checks = (fixed ? FIXED : 0) | (written === read ? DOCUMENT : 0) | (sameText ? TEXT : 0) | (sameSource ? SOURCE : 0);
    return { hash: hash(saved), checks, lost };
  };
  try {
    return cases.map(({ source, edits }) => {
      load(editor, source);
      const nodes = hash(JSON.stringify(editor.state.doc.toJSON()));
      const plain = check(source, false);
      load(editor, source);
      applyCorpusEdits(editor as unknown as DifferentialEditor, edits);
      return { nodes, plain, edited: check(source, true) };
    });
  } finally {
    editor.destroy();
    reader.destroy();
  }
}

const encode = (page: PageRecord) =>
  [page.nodes, page.plain.hash, page.edited.hash, page.plain.checks, page.edited.checks, page.plain.lost, page.edited.lost].join(' ');
const decode = (line: string): PageRecord => {
  const [nodes = '', plain = '', edited = '', plainChecks, editedChecks, plainLost, editedLost] = line.split(' ');
  return {
    nodes,
    plain: { hash: plain, checks: Number(plainChecks), lost: Number(plainLost) },
    edited: { hash: edited, checks: Number(editedChecks), lost: Number(editedLost) },
  };
};

const baselineDir = process.env.LIST_ITEM_LEADS_BASELINE_DIR;

it.runIf(baselineDir)(
  'records main’s nodes, saves and checks for the corpus',
  async () => {
    const module = (await import(/* @vite-ignore */ pathToFileURL(join(baselineDir as string, 'tiptap-editor.tsx')).href)) as EditorModule;
    const pages = record(module).map(encode);
    writeFileSync(FIXTURE, `${JSON.stringify({ revision: process.env.LIST_ITEM_LEADS_BASELINE_REVISION ?? '', sources, pages }, null, 1)}\n`);
  },
  900_000,
);

/** What each named page's saves are against main's: `same` bytes, `better` (every check
 *  passes where main fails one), `kept` (every check passes, as on main: main's document
 *  had already lost its nesting on load), and `failing` (fails only checks main fails). */
const EXPECTED_CLASSES = {
  plain: { same: 0, better: 1, kept: 0, failing: 255, textKept: 1 },
  edited: { same: 0, better: 76, kept: 42, failing: 138, textKept: 1 },
};

it.skipIf(baselineDir)(
  `the ${LIST_ITEM_LEAD_PAGES.length} named list item lead pages keep every check main passes, and lose no more text`,
  async () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { sources: string; pages: string[] };
    expect({ sources: fixture.sources, count: fixture.pages.length }).toEqual({ sources, count: cases.length });
    const main = fixture.pages.map(decode);
    const head = record(await import('./tiptap-editor'));
    const changed = head.flatMap((page, index) => {
      const before = main[index] as PageRecord;
      return page.nodes === before.nodes && page.plain.hash === before.plain.hash && page.edited.hash === before.edited.hash ? [] : [index];
    });
    expect(changed, `changed pages: ${JSON.stringify(changed)}`).toEqual(LIST_ITEM_LEAD_PAGES);
    const classes: Record<string, Record<string, number>> = { plain: {}, edited: {} };
    const worse: unknown[] = [];
    for (const index of changed) {
      for (const kind of ['plain', 'edited'] as const) {
        const now = (head[index] as PageRecord)[kind];
        const before = (main[index] as PageRecord)[kind];
        let verdict: string;
        if (now.hash === before.hash) verdict = 'same';
        else if (LIST_ITEM_LEAD_TEXT_KEPT.includes(index) && (before.checks & ~now.checks) === FIXED && now.lost < before.lost) verdict = 'textKept';
        else if ((before.checks & ~now.checks) !== 0) verdict = 'worse';
        else if (now.checks !== ALL) verdict = 'failing';
        else verdict = before.checks === ALL ? 'kept' : 'better';
        if (now.lost > before.lost) verdict = 'worse';
        const group = classes[kind] as Record<string, number>;
        group[verdict] = (group[verdict] ?? 0) + 1;
        if (verdict === 'worse') worse.push({ index, kind, now, before });
      }
    }
    console.info(`[list-item-leads-main] ${changed.length} named pages, ${JSON.stringify(classes)}`);
    expect(worse, JSON.stringify(worse)).toEqual([]);
    expect(classes).toEqual(
      Object.fromEntries(
        Object.entries(EXPECTED_CLASSES).map(([kind, counts]) => [kind, Object.fromEntries(Object.entries(counts).filter(([, n]) => n))]),
      ),
    );
  },
  900_000,
);
