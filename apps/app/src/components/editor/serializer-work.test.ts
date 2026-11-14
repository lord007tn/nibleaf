// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { MarkdownSerializerState } from 'prosemirror-markdown';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildEditorExtensions, getMarkdown, seedMarkdown } from './tiptap-editor';

// Each test builds and saves pages of a few thousand blocks. On a loaded CI runner
// such tests have taken ~28x as long as on a laptop, past Vitest's 5 s default, so
// the file gets an explicit timeout (#658). The work they bound doesn't depend on
// the machine; serializer.growth rows in the *.growth.test.ts files time it.
vi.setConfig({ testTimeout: 60_000 });

/*
 * How much of the output the serializer reads back while it saves a page (#612),
 * counted, so the bound holds however loaded the machine is. A read of
 * prosemirror-markdown's `out` hands over the whole output written so far: its
 * blank-line check runs a regular expression over it, and the editor's fence,
 * paragraph and table writers searched or sliced it. Each such read counts the
 * output's length. Appending (`out += text`, a read the engine doesn't copy) is
 * free, and so is replacing it with a shorter or equal string read just before.
 * The editor's own serializer state keeps its output in pieces and counts what it
 * reads back of them (`MarkdownOutput.charactersRead`).
 *
 * Linear saving reads back a few characters per character written. On main every
 * block read back everything before it, so a page four times as long read back
 * about sixteen times as much.
 */
const outReads = { characters: 0 };
let lastState: unknown;

beforeAll(() => {
  const values = new WeakMap<object, string>();
  let pending: { length: number } | null = null;
  Object.defineProperty(MarkdownSerializerState.prototype, 'out', {
    configurable: true,
    get(this: object) {
      const value = values.get(this) ?? '';
      outReads.characters += value.length;
      pending = { length: value.length };
      return value;
    },
    set(this: object, value: string) {
      // `out += text`: the read just before is an append, not a copy.
      if (pending && value.length > pending.length) outReads.characters -= pending.length;
      pending = null;
      values.set(this, value);
    },
  });
  const render = MarkdownSerializerState.prototype.render;
  vi.spyOn(MarkdownSerializerState.prototype, 'render').mockImplementation(function (this: MarkdownSerializerState, ...args) {
    lastState = this;
    return render.apply(this, args);
  });
});

afterAll(() => {
  delete (MarkdownSerializerState.prototype as { out?: string }).out;
  vi.restoreAllMocks();
});

/** Characters of output read back while `editor` saves, and the Markdown it saved. */
const readBack = (editor: Editor) => {
  outReads.characters = 0;
  lastState = undefined;
  const markdown = getMarkdown(editor);
  const pieces = (lastState as { output?: { charactersRead: number } } | undefined)?.output?.charactersRead ?? 0;
  return { characters: outReads.characters + pieces, length: markdown.length };
};

const QUOTE = '> '.repeat(32);
/** The four shapes of #612, at size `n`. */
const SHAPES: Array<[name: string, page: (n: number) => string, n: number]> = [
  ['list item fences', (n) => '- ```js\n  x\n  ```\n'.repeat(n), 500],
  ['fences under 32 quote levels', (n) => `${QUOTE}\`\`\`js\n${QUOTE}x\n${QUOTE}\`\`\`\n${QUOTE}\n`.repeat(n), 125],
  ['sibling fences', (n) => '```js\nx\n```\n\n'.repeat(n), 500],
  [
    'hard-wrapped paragraphs',
    (n) => 'A paragraph wrapped by hand, with **bold**\nat the end of a line and a [link](/a)\nbefore the last one.\n\n'.repeat(n),
    250,
  ],
  ['tables', (n) => '| a | b \\| c |\n| --- | :---: |\n| **x** | `y` |\n\n'.repeat(n), 250],
  ['bold and italic runs', (n) => 'Some **bold** and *italic* and ~~struck~~ words in a line.\n\n'.repeat(n), 250],
];

describe('saving a page reads back a bounded share of its output (#612)', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  afterAll(() => editor.destroy());

  it.each(SHAPES)('%s: at most 4 characters read back per character written, at n and 4n', (_name, page, n) => {
    const rows = [n, 4 * n].map((size) => {
      seedMarkdown(editor, page(size));
      return readBack(editor);
    });
    const [small, large] = rows as [{ characters: number; length: number }, { characters: number; length: number }];
    const report = `read back / written: n ${small.characters} / ${small.length}, 4n ${large.characters} / ${large.length}`;
    console.info(`${_name}: ${report}`);
    expect(small.characters, report).toBeLessThanOrEqual(4 * small.length);
    expect(large.characters, report).toBeLessThanOrEqual(4 * large.length);
    // Linear: 4x the page reads back about 4x as much, not 16x.
    expect(large.characters, report).toBeLessThanOrEqual(5 * small.characters);
  });
});
