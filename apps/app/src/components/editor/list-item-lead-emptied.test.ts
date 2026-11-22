// @vitest-environment jsdom
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { expect, it } from 'vitest';
import { textChange } from './__fixtures__/list-item-leads';

/*
 * A list item led by nested lists, `- - - x`, whose only text is deleted (#604). Each
 * lead writes nothing, so the emptied item ended its line at the markers: `- - - `,
 * three bullets of one kind, read back as a thematic break, and the item after it, at
 * its nested indent, as indented code. Every chain of markers (bullet `-`, `*`, `+`,
 * ordered `1.` and `1)`) at depths 1 to 4, at the page's top and in a quote, with and
 * without items after it, has `x` deleted and is saved. Against main's results
 * (list-item-leads-main.generate.mjs), each save:
 * - loses and adds no more text on reload than main's;
 * - passes every check main's passes: it reloads as the document it was written from,
 *   and is a fixed point over saves 2 and 3;
 * and now passes them all, with no rule or code block in the reload.
 */

const FIXED = 1;
const DOCUMENT = 2;
const ALL = FIXED | DOCUMENT;

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/list-item-lead-emptied-main.json');

const MARKERS = ['-', '*', '+', '1.', '1)'] as const;
/** The marker of the item after one with `marker`, in the same list. */
const nextMarker = (marker: string) => (marker === '1.' ? '2.' : marker === '1)' ? '2)' : marker);

/** Every chain of `MARKERS` from 1 to 4 deep. */
function chains(): string[][] {
  const all: string[][] = [];
  let level: string[][] = [[]];
  for (let depth = 1; depth <= 4; depth++) {
    level = level.flatMap((chain) => MARKERS.map((marker) => [...chain, marker]));
    all.push(...level);
  }
  return all;
}

/** What follows the emptied item: nothing, the next item of its own list, or that and the next item of the outermost list. */
const FOLLOWING = ['none', 'sibling', 'siblingAndOuter'] as const;
const CONTAINERS = ['', '> '] as const;

function pages(): string[] {
  return chains().flatMap((chain) =>
    FOLLOWING.flatMap((following) =>
      CONTAINERS.map((container) => {
        const lines = [`${chain.join(' ')} x`];
        const innermost = chain[chain.length - 1] as string;
        const column = chain.slice(0, -1).reduce((width, marker) => width + marker.length + 1, 0);
        if (following !== 'none') lines.push(`${' '.repeat(column)}${nextMarker(innermost)} Tail`);
        if (following === 'siblingAndOuter' && chain.length > 1) lines.push(`${nextMarker(chain[0] as string)} Next`);
        return lines.map((line) => `${container}${line}`).join('\n');
      }),
    ),
  );
}

type EditorModule = Pick<typeof import('./tiptap-editor'), 'buildEditorExtensions' | 'getMarkdown'>;

/** The document's blocks with their text and list starts, less the editor's empty last paragraph. */
function shape(node: PMNode, top = true): unknown {
  if (node.isText) return node.text;
  const children: unknown[] = [];
  node.forEach((child, _offset, index) => {
    if (!(top && index === node.childCount - 1 && child.type.name === 'paragraph' && child.content.size === 0)) children.push(shape(child, false));
  });
  return [node.type.name, node.type.name === 'orderedList' ? Number(node.attrs.start ?? 1) : '', children];
}

interface Result {
  page: string;
  saved: string;
  checks: number;
  lost: number;
  added: number;
  /** Whether the reload holds a thematic break or a code block, which no page here has. */
  ruleOrCode: boolean;
}

const tick = () => new Promise<void>((done) => setTimeout(done, 0));

async function run(module: EditorModule): Promise<Result[]> {
  const open = () => new Editor({ element: document.createElement('div'), extensions: module.buildEditorExtensions() });
  let editor = open();
  let reader = open();
  const load = (target: Editor, markdown: string) => target.commands.setContent(markdown, { emitUpdate: false });
  const results: Result[] = [];
  try {
    for (const [index, page] of pages().entries()) {
      // Fresh editors now and then: each one keeps its load history until it is destroyed.
      if (index && index % 200 === 0) {
        editor.destroy();
        reader.destroy();
        await tick();
        editor = open();
        reader = open();
      }
      load(editor, page);
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (at === -1 && node.isText && node.text === 'x') at = pos;
      });
      if (at === -1) throw new Error(`No x on ${JSON.stringify(page)}`);
      editor.view.dispatch(editor.state.tr.delete(at, at + 1));
      const written = JSON.stringify(shape(editor.state.doc));
      const text = editor.state.doc.textContent;
      const saved = module.getMarkdown(editor);
      load(reader, saved);
      const read = JSON.stringify(shape(reader.state.doc));
      let ruleOrCode = false;
      reader.state.doc.descendants((node) => {
        ruleOrCode ||= node.type.name === 'horizontalRule' || node.type.name === 'codeBlock';
      });
      const { lost, added } = textChange(text, reader.state.doc.textContent);
      const again = module.getMarkdown(reader);
      load(reader, again);
      const fixed = again === saved && module.getMarkdown(reader) === saved;
      results.push({ page, saved, checks: (fixed ? FIXED : 0) | (written === read ? DOCUMENT : 0), lost, added, ruleOrCode });
    }
    return results;
  } finally {
    editor.destroy();
    reader.destroy();
  }
}

const encode = ({ checks, lost, added, ruleOrCode }: Result) => `${checks} ${lost} ${added} ${ruleOrCode ? 1 : 0}`;

const baselineDir = process.env.LIST_ITEM_LEADS_BASELINE_DIR;

it.runIf(baselineDir)(
  'records main’s saves of emptied lead-led items',
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

it.skipIf(baselineDir)(
  `an item emptied in a list led by lists never saves as a rule or code, and is no worse than main (${pages().length} pages)`,
  async () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { pages: number; results: string[] };
    const results = await run(await import('./tiptap-editor'));
    expect(results.length).toBe(fixture.pages);
    const worse: unknown[] = [];
    let mainRuleOrCode = 0;
    let mainFailing = 0;
    for (const [index, result] of results.entries()) {
      const [checks, lost, added, ruleOrCode] = (fixture.results[index] as string).split(' ').map(Number) as [number, number, number, number];
      if (ruleOrCode) mainRuleOrCode++;
      if (checks !== ALL) mainFailing++;
      if (
        (checks & ~result.checks) !== 0 ||
        result.lost > lost ||
        result.added > added ||
        result.checks !== ALL ||
        result.ruleOrCode ||
        result.lost ||
        result.added
      )
        worse.push({ page: result.page, saved: result.saved, now: encode(result), main: fixture.results[index] });
    }
    console.info(
      `[list-item-lead-emptied] ${results.length} pages: main fails a check on ${mainFailing}, reads a rule or code on ${mainRuleOrCode}; now ${worse.length} fail`,
    );
    expect(worse.slice(0, 10), JSON.stringify(worse.slice(0, 10))).toEqual([]);
  },
  900_000,
);

it('writes the emptied item of `- - - x` with a bullet that is not a rule, and keeps a line with text as it is', async () => {
  const module = await import('./tiptap-editor');
  const editor = new Editor({ element: document.createElement('div'), extensions: module.buildEditorExtensions() });
  try {
    // The page, its save (every bullet list is written with `-`, as on main), and its save with `x` deleted.
    const cases: Array<[string, string, string]> = [
      ['- - - x\n    - Tail', '- - - x\n    - Tail', '- - * \n    * Tail'],
      ['* * * x\n    * Tail', '- - - x\n    - Tail', '- - * \n    * Tail'],
      ['1. - - - x\n       - Tail', '1. - - - x\n       - Tail', '1. - - * \n       * Tail'],
      ['> - - - x\n>     - Tail', '> - - - x\n>     - Tail', '> - - * \n>     * Tail'],
      ['- - x\n  - Tail', '- - x\n  - Tail', '- - \n  - Tail'],
    ];
    for (const [page, unedited, emptied] of cases) {
      editor.commands.setContent(page, { emitUpdate: false });
      expect(module.getMarkdown(editor)).toBe(unedited);
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (at === -1 && node.isText && node.text === 'x') at = pos;
      });
      editor.view.dispatch(editor.state.tr.delete(at, at + 1));
      expect(module.getMarkdown(editor)).toBe(emptied);
    }
  } finally {
    editor.destroy();
  }
}, 60_000);
