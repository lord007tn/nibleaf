// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterAll, describe, expect, it } from 'vitest';
import { applyCorpusEdits, type DifferentialEditor, serializerCorpus } from './__fixtures__/serializer-corpus';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * A code block is saved inside a fence longer than any line of its code that would close
 * it (#920). A code line made of a backtick or tilde run (up to three spaces before it,
 * only spaces or tabs after) closes a fence of that marker as long as the run or shorter.
 * Written inside such a fence, the code ended at that line and the rest of the page read
 * back as code: corpus pages 324 and 570 (an indented code block holding a ``` line, in
 * a list item, saved inside a ``` fence). An authored fence already long enough is kept.
 *
 * Generated code texts (every one and two line text from LINES, and seeded three line
 * ones), in a code block at the page's top, in a list item and in a quoted ordered list,
 * opened by an authored ```, ~~~ or ```` fence or by none (a new block): each save
 * reloads as exactly that code and the paragraph after it, and is a fixed point.
 */

const LINES = ['```', '````', '~~~', '~~~~', ' ```', '   ~~~', '    ```', '```  ', '```js', '\t```', 'code', ''];

function codeTexts(): string[] {
  const texts = LINES.filter(Boolean).map((line) => line);
  for (const first of LINES) for (const second of LINES) if (second) texts.push(`${first}\n${second}`);
  let seed = 920;
  const next = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed >>> 16;
  };
  for (let count = 0; count < 150; count++) {
    const marker = next() % 2 ? '`' : '~';
    const run = marker.repeat(3 + (next() % 18));
    const prefix = ' '.repeat(next() % 4);
    texts.push(`${LINES[next() % LINES.length]}\n${prefix}${run}\nend`);
  }
  return texts;
}

const CONTAINERS = [
  { name: 'page', first: '', rest: '' },
  { name: 'list item', first: '- ', rest: '  ' },
  { name: 'quoted ordered list', first: '> 1. ', rest: '>    ' },
  { name: 'list inside three quotes', first: '> > > - ', rest: '> > >   ' },
] as const;
const OPENERS = ['```js', '~~~', '````', null] as const;

/** The page with a code block of one `old` line opened by `opener`, in `container`, then a paragraph. */
const page = (container: (typeof CONTAINERS)[number], opener: string) => {
  const close = /^(`+|~+)/.exec(opener)?.[1] as string;
  return `${container.first}${opener}\n${container.rest}old\n${container.rest}${close}\n\nAfter`;
};

function codeBlocks(doc: PMNode): PMNode[] {
  const blocks: PMNode[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'codeBlock') blocks.push(node);
  });
  return blocks;
}

describe('a code block’s fence is longer than any line of its code that would close it (#920)', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  const reader = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  afterAll(() => {
    editor.destroy();
    reader.destroy();
  });
  const load = (target: Editor, markdown: string) => target.commands.setContent(markdown, { emitUpdate: false });

  it.each(['-', '*', '+'])('preserves an untouched, indented quote fence before another %s list', (bullet) => {
    const source = `Before\n\n- Top\n\n  >  \`\`\`\n  >   x\n\n${bullet} next`;
    load(editor, source);
    editor.view.dispatch(editor.state.tr.insertText('!', 7));
    const saved = getMarkdown(editor);
    expect(saved).toContain('  >  ```\n  >   x\n');
    load(reader, saved);
    expect(codeBlocks(reader.state.doc).map((block) => block.textContent)).toEqual([' x']);
    expect(getMarkdown(reader)).toBe(saved);
  });

  it.each(['```js', '~~~sh', '````md'])('preserves %s on code edits when a tab-indented run cannot close it', (opener) => {
    const close = /^(`+|~+)/.exec(opener)?.[1];
    const source = `${opener}\nold\n\t${close}\ntail\n${close}\n\nAfter`;
    load(editor, source);
    editor.view.dispatch(editor.state.tr.insertText('new', 1, 4));
    const saved = getMarkdown(editor);
    expect(saved).toBe(source.replace('old', 'new'));
    load(reader, saved);
    expect(getMarkdown(reader)).toBe(saved);
  });

  it('saves generated code texts so that each reloads as written, with the page after it', () => {
    const texts = codeTexts();
    const failures: unknown[] = [];
    let checked = 0;
    for (const container of CONTAINERS) {
      for (const opener of OPENERS) {
        for (const code of texts) {
          load(editor, page(container, opener ?? '```'));
          let at = -1;
          let block: PMNode | null = null;
          editor.state.doc.descendants((node, pos) => {
            if (at === -1 && node.type.name === 'codeBlock') {
              at = pos;
              block = node;
            }
          });
          const found = block as PMNode | null;
          if (!found) throw new Error(`No code block in ${page(container, opener ?? '```')}`);
          let tr = editor.state.tr.replaceWith(at + 1, at + 1 + found.content.size, editor.schema.text(code));
          // No opener: a code block made in the editor, with none of the source's fence.
          if (opener === null) tr = tr.setNodeMarkup(at, undefined, { language: '' });
          editor.view.dispatch(tr);
          const text = editor.state.doc.textContent;
          const saved = getMarkdown(editor);
          load(reader, saved);
          const reloaded = codeBlocks(reader.state.doc).map((node) => node.textContent);
          const again = getMarkdown(reader);
          load(reader, again);
          const fixed = again === saved && getMarkdown(reader) === saved;
          checked++;
          if (reloaded.length !== 1 || reloaded[0] !== code || reader.state.doc.textContent !== text || !fixed)
            failures.push({ container: container.name, opener, code, saved, reloaded, fixed });
        }
      }
    }
    expect(checked).toBe(CONTAINERS.length * OPENERS.length * texts.length);
    expect(failures.slice(0, 5), `${failures.length} of ${checked} failed: ${JSON.stringify(failures.slice(0, 5))}`).toEqual([]);
  }, 300_000);

  it('keeps an authored fence that is already long enough, and lengthens one that is not', () => {
    load(editor, '````md\n```js\nx\n```\n````\n\nAfter');
    expect(getMarkdown(editor)).toBe('````md\n```js\nx\n```\n````\n\nAfter');
    load(editor, '~~~\n```\n~~~\n\nAfter');
    expect(getMarkdown(editor)).toBe('~~~\n```\n~~~\n\nAfter');
    load(editor, '```js\nold\n```\n\nAfter');
    const block = codeBlocks(editor.state.doc)[0] as PMNode;
    editor.view.dispatch(editor.state.tr.replaceWith(1, 1 + block.content.size, editor.schema.text('a\n```\nb')));
    expect(getMarkdown(editor)).toBe('````js\na\n```\nb\n````\n\nAfter');
  });

  it.each([206, 324, 570, 764])('saves corpus page %i with all its text and no literal delimiters', (index) => {
    const { source, edits } = serializerCorpus()[index] as ReturnType<typeof serializerCorpus>[number];
    for (const edited of [false, true]) {
      load(editor, source);
      if (edited) applyCorpusEdits(editor as unknown as DifferentialEditor, edits);
      const text = editor.state.doc.textContent;
      const saved = getMarkdown(editor);
      load(reader, saved);
      expect(reader.state.doc.textContent).toBe(text);
      const again = getMarkdown(reader);
      expect(again).toBe(saved);
      load(reader, again);
      expect(getMarkdown(reader)).toBe(saved);
    }
  });
});
