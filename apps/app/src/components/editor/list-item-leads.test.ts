// @vitest-environment jsdom
import { setImmediate } from 'node:timers/promises';
import { createDocument, Editor } from '@tiptap/core';
import { undoDepth } from '@tiptap/pm/history';
import type { Node as PMNode } from '@tiptap/pm/model';
import { AllSelection } from '@tiptap/pm/state';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { Markdown } from '@/components/markdown';
import { textChange } from './__fixtures__/list-item-leads';
import mainMarkFailures from './__fixtures__/overlapping-marks-main.json';
import { applyCorpusEdits, type DifferentialEditor, serializerCorpus } from './__fixtures__/serializer-corpus';
import { markdownToEmit } from './editor-change-origin';
import { buildEditorExtensions, getMarkdown, seedMarkdown } from './tiptap-editor';

/*
 * A list item whose first block is a quote, a heading or a nested list keeps that block
 * on its marker's line (#604, #865), with no lead metadata and no rebuild of the page, so
 * edits near a lead behave as edits anywhere else (the review rows of #887).
 */

const editors: Editor[] = [];
function open(source: string): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: buildEditorExtensions(),
    editorProps: { handleScrollToSelection: () => true },
  });
  // As a page loads: no undo step.
  seedMarkdown(editor, source);
  editors.push(editor);
  return editor;
}
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

it.each(['-', '*'])('keeps nested %s items when their first child contains only a space or tab', (bullet) => {
  for (const prefix of ['', '> ']) {
    for (const whitespace of [' ', '  ', '\t']) {
      const editor = open(`${prefix}${bullet} ${bullet} ${bullet} x\n${prefix}    ${bullet} Tail`);
      const at = find(editor, 'x');
      editor.view.dispatch(editor.state.tr.insertText(whitespace, at, at + 1));
      const expected = `${prefix}- - * \n${prefix}    * Tail`;
      expect(getMarkdown(editor)).toBe(expected);
      stable(expected);
    }
  }
});

it.each(['space', 'two empty paragraphs'])('keeps the parent text separate from a nested marker after %s', (edit) => {
  const editor = open('- Top\n  - x\n  - Tail\n- Next');
  const at = find(editor, 'x');
  const tr = editor.state.tr;
  editor.view.dispatch(edit === 'space' ? tr.insertText(' ', at, at + 1) : tr.delete(at, at + 1).split(at));
  const saved = getMarkdown(editor);
  expect(saved).toBe('- Top\n\n  - \n  - Tail\n\n- Next');
  stable(saved);
});

it.each(['a b c d e', 'أ ب ت ث ج'])('preserves %s when italic starts an overlapping strike and bold edit', (source) => {
  for (const prefix of ['', 'Intro\n\n', '- ', '> ']) {
    const editor = open(`${prefix}${source}`);
    const at = find(editor, source);
    const tr = editor.state.tr
      .addMark(at, at + 5, editor.schema.mark('strike'))
      .addMark(at + 2, at + 7, editor.schema.mark('bold'))
      .addMark(at, at + 1, editor.schema.mark('italic'));
    editor.view.dispatch(tr);
    const saved = getMarkdown(editor);
    expect(open(saved).state.doc.textContent).toBe(editor.state.doc.textContent);
    expect(getMarkdown(open(saved))).toBe(saved);
  }
});

it('round-trips generated overlapping strike, bold and italic ranges in English and Arabic', async () => {
  const ranges = Array.from({ length: 5 }, (_, start) =>
    Array.from({ length: 5 - start }, (_, offset) => ({ start, end: start + offset + 1 })),
  ).flat();
  const contexts = [
    ['plain', ''],
    ['after a paragraph', 'Intro\n\n'],
    ['list item', '- '],
    ['quote', '> '],
  ] as const;
  expect(mainMarkFailures.contexts).toEqual(contexts.map(([name]) => name));
  // These named cases also fail on main at the recorded revision in both languages.
  // Each allowance is main's number of literal delimiters in that context.
  const allowances = new Map(mainMarkFailures.groups.flatMap(({ ranges, maxAdded }) => ranges.map((name) => [name, maxAdded] as const)));
  const failures: unknown[] = [];
  let checked = 0;
  let mainFailuresChecked = 0;
  for (const source of ['a b c d e', 'أ ب ت ث ج']) {
    for (const [contextIndex, [context, prefix]] of contexts.entries()) {
      const editor = open(`${prefix}${source}`);
      const expected = editor.state.doc.textContent;
      const at = find(editor, source);
      const { parser, serializer } = (
        editor.storage as unknown as {
          markdown: { parser: { parse(source: string): string }; serializer: { serialize(doc: PMNode): string } };
        }
      ).markdown;
      for (const strike of ranges) {
        for (const bold of ranges) {
          for (const italic of ranges) {
            const [first, second, third] = [strike, bold, italic].sort((left, right) => left.start - right.start);
            // All three ranges must form one overlap, including an overlap connected by the middle range.
            if (!(first && second && third) || second.start >= first.end || third.start >= Math.max(first.end, second.end)) continue;
            // Use the parser and serializer from load/save without mounting each generated edit in the editor view.
            const tr = editor.state.tr;
            for (const [name, { start, end }] of [
              ['strike', strike],
              ['bold', bold],
              ['italic', italic],
            ] as const) {
              tr.addMark(at + 2 * start, at + 2 * end - 1, editor.schema.mark(name));
            }
            const saved = serializer.serialize(tr.doc);
            const reloaded = createDocument(parser.parse(saved), editor.schema);
            const savedAgain = serializer.serialize(reloaded);
            checked++;
            // A case name is the three half-open word ranges in strike, bold, italic order.
            const name = [strike, bold, italic].map(({ start, end }) => `${start}-${end}`).join('/');
            const maxAdded = allowances.get(name)?.[contextIndex];
            let valid = reloaded.textContent === expected && savedAgain === saved;
            if (maxAdded != null) {
              mainFailuresChecked++;
              valid = reloaded.textContent.replace(/[*~]/g, '') === expected && reloaded.textContent.length - expected.length <= maxAdded;
            }
            if (!valid) failures.push({ source, context, name, maxAdded, saved, reloaded: reloaded.textContent, savedAgain });
            // Let jsdom release the parsed documents between batches.
            if (checked % 100 === 0) await setImmediate();
          }
        }
      }
    }
  }
  expect(checked).toBe(18_600);
  expect(mainFailuresChecked).toBe(9260);
  expect(failures.slice(0, 5), `${failures.length} overlapping mark cases failed`).toEqual([]);
}, 300_000);

it('preserves the strike and bold overlap when an independent word is bold and italic', () => {
  const editor = open('a b c d e f');
  const at = find(editor, 'a b c d e f');
  editor.view.dispatch(
    editor.state.tr
      .addMark(at, at + 5, editor.schema.mark('strike'))
      .addMark(at + 2, at + 7, editor.schema.mark('bold'))
      .addMark(at + 10, at + 11, editor.schema.mark('bold'))
      .addMark(at + 10, at + 11, editor.schema.mark('italic')),
  );
  const saved = getMarkdown(editor);
  expect(saved).toBe('~~a **b c**~~ **d** e ***f***');
  expect(open(saved).state.doc.textContent).toBe('a b c d e f');
  stable(saved);
});

it('keeps the strike opener readable when a strike starts at punctuation inside a word', () => {
  const editor = open('a-b c d e');
  const at = find(editor, 'a-b c d e');
  editor.view.dispatch(editor.state.tr.addMark(at + 1, at + 5, editor.schema.mark('strike')).addMark(at + 4, at + 7, editor.schema.mark('bold')));
  const saved = getMarkdown(editor);
  expect(saved).toBe('a-~~b~~ **~~c~~ d** e');
  expect(open(saved).state.doc.textContent).toBe('a-b c d e');
});

/** The document's containers and text, less empty paragraphs and source attributes. */
function shape(node: PMNode): unknown {
  if (node.type.name === 'paragraph' && node.content.size === 0) return null;
  if (node.isText) return node.text;
  const children: unknown[] = [];
  node.forEach((child) => {
    const value = shape(child);
    if (value !== null) children.push(value);
  });
  return { type: node.type.name, start: node.attrs.start, level: node.attrs.level, children };
}

/** The page saves as `expected` (itself by default), then as that over four load and save cycles. */
function stable(source: string, expected = source): void {
  let saved = source;
  for (let cycle = 0; cycle < 4; cycle++) {
    saved = getMarkdown(open(saved));
    expect(saved, JSON.stringify(source)).toBe(expected);
  }
}

/** The save reloads as the document it was written from and saves the same again. */
function expectFixed(editor: Editor): string {
  const saved = getMarkdown(editor);
  const reloaded = open(saved);
  expect(shape(reloaded.state.doc)).toEqual(shape(editor.state.doc));
  expect(reloaded.state.doc.textContent).toBe(editor.state.doc.textContent);
  expect(getMarkdown(reloaded)).toBe(saved);
  return saved;
}

/** Each list item's empty first paragraph, where the caret goes. */
function leads(editor: Editor): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos, parent) => {
    if (parent?.type.name === 'listItem' && parent.firstChild === node && node.type.name === 'paragraph' && !node.content.size)
      positions.push(pos + 1);
  });
  return positions;
}
function lead(editor: Editor, which = 0): number {
  const position = leads(editor).at(which);
  if (position === undefined) throw new Error('No lead');
  return position;
}

/** Where `text` starts in the document. */
function find(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    const at = node.isText ? (node.text ?? '').indexOf(text) : -1;
    if (found === -1 && at !== -1) found = pos + at;
  });
  if (found === -1) throw new Error(`No ${text}`);
  return found;
}

/** The parent types of every node of `type`, in document order. */
function parents(editor: Editor, type: string): string[] {
  const names: string[] = [];
  editor.state.doc.descendants((node, _pos, parent) => {
    if (node.type.name === type) names.push(parent?.type.name ?? '');
  });
  return names;
}

/** Text before the caret, without block separators. */
const beforeCaret = (editor: Editor) => editor.state.doc.textBetween(0, editor.state.selection.from, '');

function paste(editor: Editor, value: string, mime = 'text/plain'): void {
  const clipboardData = { files: [], types: [mime], getData: (type: string) => (type === mime ? value : '') };
  editor.view.dom.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), { clipboardData }));
}

/** How many transactions changed the document from now on. */
function changes(editor: Editor): () => number {
  let count = 0;
  editor.on('transaction', ({ transaction }) => {
    if (transaction.docChanged) count++;
  });
  return () => count;
}

const AR: Record<string, string> = {
  quoted: 'اقتباس',
  Heading: 'عنوان',
  nested: 'متداخل',
  Alpha: 'ألف',
  Beta: 'باء',
  Charlie: 'جيم',
  Delta: 'دال',
  Top: 'أعلى',
  Gamma: 'جيم',
  Tail: 'نهاية',
  Item: 'عنصر',
  Next: 'التالي',
  Outro: 'خاتمة',
};
const arabic = (source: string) => source.replace(/[A-Z][a-z]+|quoted|nested/g, (word) => AR[word] ?? word);
const quoted = (source: string) =>
  source
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');

describe('list items led by a quote, heading or list (#604, #865)', () => {
  it.each(['> quoted', '# Heading', '## Heading', '- nested', '1. nested', '> [!NOTE]\n  > quoted'])(
    'keeps %j on the marker line, bullet and ordered, tight and loose, nested and quoted, EN and AR',
    (block) => {
      for (const [marker, next] of [
        ['-', '-'],
        ['1.', '2.'],
        ['10)', '11)'],
      ] as const) {
        const indent = ' '.repeat(marker.length + 1);
        const item = (m: string) => `${m} ${block.replaceAll('\n  ', `\n${indent}`)}`;
        for (const gap of ['\n', '\n\n']) {
          const list = `${item(marker)}${gap}${item(next)}`;
          const nested = `- Top\n${list
            .split('\n')
            .map((line) => (line ? `  ${line}` : ''))
            .join('\n')}\n\nOutro.`;
          // An ordered list from 10 cannot interrupt `Top`, so it nests only from 1.
          // Main writes an ordered list's `)` as `.` (tiptap-markdown); that stays as it was.
          for (const page of [`${list}\n\nOutro.`, ...(marker === '10)' ? [] : [nested]), quoted(`${list}\n\nOutro.`)])
            for (const source of [page, arabic(page)]) stable(source, source.replace(/(1[01])\)/g, '$1.'));
        }
      }
    },
    // 32 pages, each loaded and saved four times.
    60_000,
  );

  it('keeps the #604 shapes byte for byte', () => {
    stable('- > quoted\n- # Heading\n- - nested');
    stable(arabic('- > quoted\n- # Heading\n- - nested'));
    stable('1. # A\n2. # B\n3. # C\n4. # D');
  });

  it('keeps the #865 quote inside its nested item byte for byte', () => {
    for (const source of ['- Top\n  - > Alpha', arabic('- Top\n  - > Alpha')]) {
      expect(parents(open(source), 'blockquote')).toEqual(['listItem']);
      stable(source);
    }
  });

  it('the published reader keeps the #865 quote inside the same nested item', () => {
    const source = '- Top\n  - > Alpha';
    const render = (content: string) => renderToStaticMarkup(createElement(Markdown, { content }));
    const html = render(source);
    expect(render(getMarkdown(open(source)))).toBe(html);
    const root = document.createElement('div');
    root.innerHTML = html;
    expect(root.querySelector('li > ul > li > blockquote')?.textContent?.trim()).toBe('Alpha');
  }, 30_000);

  it('keeps a paragraph after a quote-led item outside the item', () => {
    const source = '- > quoted\n\n  Inside.\n\n- Next\n\nOutro.';
    stable(source);
    expect(open(source).state.doc.child(1).textContent).toBe('Outro.');
  });

  // #604's acceptance corpus (issuecomment-6947548768): the 18 cases of #858's interaction
  // corpus, each with its first textblock deleted.
  const acceptance: Array<{ index: number; source: string }> = [];
  const bodies = [
    '- Alpha\n  - Beta\n\n  - Charlie\n- Delta',
    '- Top\n  - > Alpha',
    '- Alpha\n\n- Beta',
    '> quoted\n>\n> more',
    '```js\nconst x = 1;\n```',
    '- ~~~js\n  >\n- b',
    '1. Alpha\n   - Beta\n\n   - Gamma\n2. Delta',
  ];
  const indices = [0, 1, 2, 6, 7, 8, 12, 13, 14, 18, 19, 20, 72, 73, 74, 78, 79, 80];
  let index = 0;
  for (const body of bodies)
    for (const tag of ['Note', 'Accordion title="A"'])
      for (const layout of ['\n', '\n\n'])
        for (const container of [0, 1, 2]) {
          let source = `<${tag}>${layout}${body}\n\nTail.${layout}</${tag.split(' ')[0]}>`;
          if (container === 1)
            source = source
              .split('\n')
              .map((line) => `> ${line}`)
              .join('\n');
          if (container === 2)
            source = `- Item\n\n${source
              .split('\n')
              .map((line) => `  ${line}`)
              .join('\n')}\n\n- Next`;
          if (indices.includes(index)) acceptance.push({ index, source });
          index++;
        }

  it('the acceptance corpus has its 18 cases', () => {
    expect(acceptance).toHaveLength(18);
  });

  it.each(acceptance)('#858 interaction case $index stays nested after deleting its first textblock, EN and AR', ({ source }) => {
    for (const page of [source, arabic(source)]) {
      const editor = open(page);
      let component: { node: PMNode; pos: number } | undefined;
      editor.state.doc.descendants((node, pos) => {
        if (!component && node.attrs.sourceOpen && !node.isAtom) component = { node, pos };
      });
      if (!component) throw new Error('Missing component');
      let first: { node: PMNode; pos: number } | undefined;
      editor.state.doc.nodesBetween(component.pos + 1, component.pos + component.node.nodeSize - 1, (node, pos) => {
        if (!first && node.isTextblock) first = { node, pos };
      });
      if (!first) throw new Error('Missing textblock');
      editor.view.dispatch(editor.state.tr.delete(first.pos, first.pos + first.node.nodeSize));
      stable(expectFixed(editor));
    }
  });

  // The swallowing case of the parked branch (#887): attribute differential page 27. Its
  // HTML-led item keeps main's save (#871), and `Outro.` stays outside it.
  it('does not swallow Outro in the attribute differential case 27', () => {
    const source =
      'Intro.\n\n- <Update label="a\rb" hidden>\n  \n  <Card title="Inner\n  line">\n  \n  Inner text.\n  \n  </Card>\n  \n  </Update>\n\nOutro.';
    const saved = getMarkdown(open(source));
    expect(saved).toBe(
      'Intro.\n\n- \n\n<Update label="a\n&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;b&quot;&gt;&lt;/p&gt;  &lt;div data-mdx=" hidden>\n\nInner text.\n\n</Update>\n\nOutro.',
    );
    const doc = open(saved).state.doc;
    expect(doc.lastChild?.type.name).toBe('paragraph');
    expect(doc.lastChild?.textContent).toBe('Outro.');
  });

  // #871 owns items led by an HTML block or a component: they keep main's save.
  it('keeps HTML and component-led items as main saves them', () => {
    expect(
      [
        '- <Note>\n\n  Text\n\n  </Note>\n\n- next',
        '- <div class="note">\n  <b>Bold</b>\n  </div>\n\nOutro.',
        '1. Item\n\n   - <Accordion title="A">\n\n     Text\n\n     </Accordion>\n\n2. Next',
        '> - <Note>\n>\n>   Text\n>\n>   </Note>',
      ].map((source) => getMarkdown(open(source))),
    ).toEqual([
      '- \n\n<Note>\n\nText\n\n</Note>\n\n- next',
      '- <div class="note">\n  <b>Bold</b>\n  </div>\n\nOutro.',
      '1. Item\n\n   - \n\n   <Accordion title="A">\n\n   Text\n\n   </Accordion>\n\n2. Next',
      '> - \n>\n> <Note>\n>\n> Text\n>\n> </Note>',
    ]);
  });
});

describe('adjacent bullet lists (#604)', () => {
  it('a bullet list straight after another takes the other bullet, so the two stay two lists', () => {
    for (const [source, saved] of [
      ['* a\n- b', '- a\n\n\n* b'],
      ['- a\n\n* b\n\n- c', '- a\n\n\n* b\n\n\n- c'],
      ['- # a\n\n* b', '- # a\n\n\n* b'],
    ] as const) {
      const editor = open(source);
      expect(getMarkdown(editor)).toBe(saved);
      expect(expectFixed(editor)).toBe(saved);
      expect(open(saved).state.doc.childCount).toBe(editor.state.doc.childCount);
    }
  });

  it('ordered lists keep tiptap-markdown’s own `.` and `)`', () => {
    expect(getMarkdown(open('1. a\n1) b'))).toBe('1. a\n\n\n1) b');
  });
});

// Each row of #887's two review rounds, as a test of the saved bytes and, for the edits,
// the edit's target, the caret, the undo depth and whether the draft changed.
describe('edits of lead-led items, from #887’s reviews (#604, #865)', () => {
  it.each(['> Alpha', '## Heading'])('a marker-only %s item saves on its marker line, never as code', (block) => {
    const editor = open(`10)\n    ${block}\n\nOutro.`);
    const saved = expectFixed(editor);
    expect(saved).toBe(`10. ${block}\n\nOutro.`);
    expect(parents(open(saved), 'codeBlock')).toEqual([]);
    expect(parents(open(saved), block.startsWith('>') ? 'blockquote' : 'heading')).toEqual(['listItem']);
  });

  it.each(['> Alpha', '## Heading'])('Enter in the lead of `- %s` keeps the block in its item', (block) => {
    const editor = open(`- ${block}`);
    editor.commands.setTextSelection(lead(editor));
    editor.commands.keyboardShortcut('Enter');
    expect(undoDepth(editor.state)).toBe(1);
    const saved = expectFixed(editor);
    expect(saved).toBe(`- \n- ${block}`);
    expect(parents(open(saved), block.startsWith('>') ? 'blockquote' : 'heading')).toEqual(['listItem']);
  });

  it('text typed into a lead of a tight list saves to a fixed point', () => {
    const editor = open('- > Alpha\n- > Beta');
    const at = lead(editor);
    editor.commands.setTextSelection(at);
    editor.commands.insertContent('Typed');
    expect(editor.state.selection.from).toBe(at + 5);
    expect(beforeCaret(editor)).toBe('Typed');
    expect(undoDepth(editor.state)).toBe(1);
    expect(expectFixed(editor)).toBe('- Typed\n\n  > Alpha\n\n- > Beta');
  });

  it('text typed into a lead before an ordered list that cannot interrupt it keeps the list', () => {
    const editor = open('- 10) Child\n  11) Next\n- Sibling\n\nOutro.');
    editor.commands.setTextSelection(lead(editor));
    editor.commands.insertContent('Typed');
    const saved = expectFixed(editor);
    expect(saved).toBe('- Typed\n\n  10. Child\n  11. Next\n\n- Sibling\n\nOutro.');
    expect(parents(open(saved), 'orderedList')).toEqual(['listItem']);
  });

  it('a draft video survives a list toggle in a lead', () => {
    const editor = open('- > a\n\nFirst\n\nMiddle\n\nLast\n\n1. > b');
    const middle = find(editor, 'Middle') - 1;
    editor.commands.insertContentAt(middle, { type: 'videoEmbed', attrs: { src: '', title: 'Unsaved title' } });
    editor.commands.setTextSelection(lead(editor));
    editor.commands.toggleOrderedList();
    const videos: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'videoEmbed') videos.push(String(node.attrs.title));
    });
    expect(videos).toEqual(['Unsaved title']);
  });

  it('deleting a heading’s first letters deletes those letters', () => {
    const editor = open('- # abcdef');
    const at = find(editor, 'abc');
    editor.commands.deleteRange({ from: at, to: at + 3 });
    expect(editor.state.doc.textContent).toBe('def');
    expect(undoDepth(editor.state)).toBe(1);
    expect(expectFixed(editor)).toBe('- # def');
  });

  it('the Heading 2 slash command in a quote-led item turns that line into a heading', () => {
    const editor = open('- > /h2 Keep');
    const at = find(editor, '/h2 ');
    // The slash item's own command (slash-items/basic.ts).
    editor
      .chain()
      .deleteRange({ from: at, to: at + 4 })
      .setNode('heading', { level: 2 })
      .run();
    expect(editor.state.doc.textContent).toBe('Keep');
    expect(parents(editor, 'heading')).toEqual(['blockquote']);
    expect(expectFixed(editor)).toBe('- > ## Keep');
  });

  it('Backspace at the start of the next paragraph joins it to the quote, caret at the join', () => {
    const editor = open('- > a\n\nParagraph');
    editor.commands.setTextSelection(find(editor, 'Paragraph'));
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    editor.commands.insertContent('X');
    expect(editor.state.doc.textContent).toBe('aXParagraph');
    expect(beforeCaret(editor)).toBe('aX');
    expect(expectFixed(editor)).toBe('- > aXParagraph');
  });

  it('a paste after `Para` is one undo step, and undo restores the page', () => {
    const source = '- > a\n\nParagraph';
    const editor = open(source);
    editor.commands.setTextSelection(find(editor, 'Paragraph') + 4);
    paste(editor, 'Word');
    expect(editor.state.doc.textContent).toBe('aParaWordgraph');
    expect(beforeCaret(editor)).toBe('aParaWord');
    expect(undoDepth(editor.state)).toBe(1);
    editor.commands.undo();
    expect(getMarkdown(editor)).toBe(source);
  });

  it('a rejected sinkListItem leaves the draft clean', () => {
    const source = '- > a';
    const editor = open(source);
    const loaded = getMarkdown(editor);
    const count = changes(editor);
    editor.commands.setTextSelection(lead(editor));
    expect(editor.commands.sinkListItem('listItem')).toBe(false);
    expect(count()).toBe(0);
    expect(undoDepth(editor.state)).toBe(0);
    expect(markdownToEmit({ source, serialized: loaded }, getMarkdown(editor))).toBe(source);
  });

  it('a drop far from a lead is one undo step, and leaves the list’s nodes as they were', () => {
    const editor = open('A\n\nB\n\nC\n\nD\n\n- > a');
    const list = editor.state.doc.child(4);
    editor.view.dispatch(editor.state.tr.insertText('Dropped', find(editor, 'A') + 1).setMeta('uiEvent', 'drop'));
    expect(undoDepth(editor.state)).toBe(1);
    expect(editor.state.doc.child(4)).toBe(list);
    expect(getMarkdown(editor)).toBe('ADropped\n\nB\n\nC\n\nD\n\n- > a');
  });

  it('a paste into a lead during composition changes nothing', () => {
    const editor = open('- > a');
    const doc = editor.state.doc;
    editor.commands.setTextSelection(lead(editor));
    (editor.view as unknown as { input: { composing: boolean } }).input.composing = true;
    paste(editor, 'Word');
    (editor.view as unknown as { input: { composing: boolean } }).input.composing = false;
    expect(editor.state.doc).toBe(doc);
    expect(undoDepth(editor.state)).toBe(0);
  });

  it('an edit elsewhere on the page leaves the lead-led list’s nodes alone', () => {
    const editor = open('Intro\n\nMiddle\n\nOther\n\n- > a');
    const list = editor.state.doc.child(3);
    editor.commands.setTextSelection(find(editor, 'Middle'));
    editor.commands.keyboardShortcut('Backspace');
    expect(editor.state.doc.child(2)).toBe(list);
    expect(getMarkdown(editor)).toBe('IntroMiddle\n\nOther\n\n- > a');
  });
});

// A paragraph opening with bold, after another block in a quoted list item: the bold's
// whitespace trim started before the line's `>` prefix and wrote `****bold**`. A
// heading-led item in a quote now keeps its blocks in the item, which reaches it.
describe('a quoted list item’s paragraph that opens with bold (#604)', () => {
  it('keeps the quote prefix before a bold line after a hard break', () => {
    stable('> - first\\\n>   **second**');
  });

  const published = (content: string) => {
    const root = document.createElement('div');
    root.innerHTML = renderToStaticMarkup(createElement(Markdown, { content }));
    return root;
  };
  const words = (text: string) => text.replace(/\s+/g, '');

  it('typing before a heading-led item in a quote saves it in its item, reading as main’s save does', () => {
    const editor = open('Intro\n\n> - # See![x](/x.png) **bold**');
    editor.commands.insertContentAt(find(editor, 'Intro') + 5, '!');
    const saved = expectFixed(editor);
    expect(saved).toBe('Intro!\n\n> - # See\n>\n>   ![x](/x.png)\n>\n>   **bold**');
    expect(getMarkdown(open(getMarkdown(open(saved))))).toBe(saved);
    const reader = published(saved);
    expect(reader.querySelector('blockquote > ul > li > h1')?.textContent).toBe('See');
    expect(reader.querySelector('blockquote > ul > li > p > strong')?.textContent).toBe('bold');
    // Main moved the heading out of its item; its save read back as this text, with no `*`.
    const main = 'Intro!\n\n> - \n>\n> # See\n>\n> ![x](/x.png)\n>\n> **bold**';
    expect(words(reader.textContent ?? '')).toBe(words(published(main).textContent ?? ''));
    expect(words(reader.textContent ?? '')).toBe('Intro!Seebold');
  }, 30_000);

  it('saves the bold paragraph after any block of a quoted item to a fixed point', () => {
    for (const source of [
      '> - # See\n>\n>   ![x](/x.png)\n>\n>   **bold**',
      '> - a\n>\n>   ![x](/x.png)\n>\n>   **bold**',
      '> - a\n>\n>   para\n>\n>   **bold** end',
      '> 1. > q\n>\n>    *em* end',
      '> > - # See\n> >\n> >   **bold**',
    ])
      stable(source);
  });

  // Corpus page 86: a list after a list of its type is written after two blank lines,
  // which an unclosed fence ending the list before read as more code (main too, for
  // `- a` then `  - ~~~md`). It gets its closing line there.
  it('an unclosed fence ending a list before a list of its type gets its closing line', () => {
    for (const [source, expected] of [
      ['- a\n  - ~~~md\n    x\n  + b', '- a\n\n  - ~~~md\n    x\n    ~~~\n\n\n  * b'],
      ['* - a\n  - ~~~md\n    x\n  + b', '- - a\n  - ~~~md\n    x\n    ~~~\n\n\n  * b'],
    ] as const) {
      const editor = open(source);
      expect(expectFixed(editor)).toBe(expected);
      expect(textChange(editor.state.doc.textContent, open(expected).state.doc.textContent)).toEqual({ lost: 0, added: 0 });
    }
  });

  it('corpus page 859 reads back with no text added and no more lost than main', () => {
    const page = serializerCorpus()[859];
    if (!page) throw new Error('No page 859');
    for (const edited of [false, true]) {
      const editor = open(page.source);
      if (edited) applyCorpusEdits(editor as unknown as DifferentialEditor, page.edits);
      const saved = getMarkdown(editor);
      const reloaded = open(saved);
      // Main lost one character here, unedited and edited: the `+` of the `<Tabs>`-led item (#871).
      expect(textChange(editor.state.doc.textContent, reloaded.state.doc.textContent)).toEqual({ lost: 1, added: 0 });
      expect(saved).not.toContain('****');
      expect(saved).toContain(`> - # See\n>\n>   ![an image](/x.png)\n>\n>   **bold at the end** 🚀 ${edited ? 'tare' : 'tab here'}\n`);
      // The second save rewrites only the HTML-led items main rewrites too (#871); the
      // heading-led item and its bold paragraph stay as written.
      const again = getMarkdown(reloaded);
      expect(again).toContain(`> - # See\n>\n>   ![an image](/x.png)\n>\n>   **bold at the end** 🚀 ${edited ? 'tare' : 'tab here'}\n`);
      expect(getMarkdown(open(again))).toBe(again);
      const reader = published(saved);
      expect(reader.querySelector('li > h1')?.textContent).toBe('See');
      expect(reader.textContent).not.toContain('**');
    }
  }, 60_000);
});

// Shapes the list item lead matrix found, each saved to a fixed point.
describe('lists that edits around a lead leave (#604, #865)', () => {
  const key = (editor: Editor, name: string, shiftKey = false) =>
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }));

  it('Tab indents a quote-led item into the item above', () => {
    const editor = open('1. - Child\n2. > Beta');
    editor.commands.setTextSelection(lead(editor, -1));
    key(editor, 'Tab');
    expect(undoDepth(editor.state)).toBe(1);
    expect(parents(editor, 'blockquote')).toEqual(['listItem']);
    expect(expectFixed(editor)).toBe('1. - Child\n   1. > Beta');
  });

  it('an ordered list from 10 nested after another list or a quote keeps its place', () => {
    const editor = open('- 10) Child\n  11) Next\n- > Beta');
    editor.commands.setTextSelection(lead(editor));
    paste(editor, '> Paste\n\n- new');
    expect(parents(open(expectFixed(editor)), 'orderedList')).toEqual(['listItem']);
  });

  it('two lists of one type with an empty paragraph between them stay two lists', () => {
    for (const source of ['- # a\n- - b', '1. # a\n2. 1) b']) {
      const editor = open(source);
      editor.commands.setTextSelection(lead(editor, -1));
      key(editor, 'Backspace');
      const saved = expectFixed(editor);
      expect(open(saved).state.doc.childCount).toBe(editor.state.doc.childCount - 1);
    }
  });

  it('an item opening with two empty paragraphs before its nested list writes the list on its line', () => {
    const editor = open('1. -\n   - x');
    editor.commands.setTextSelection(lead(editor, -1));
    key(editor, 'Enter');
    const saved = getMarkdown(editor);
    expect(saved).toBe('1. - x');
    expect(getMarkdown(open(saved))).toBe(saved);
  });

  it('a pasted list of empty and fence-led items, which reads back tight, is written tight', () => {
    for (const html of [
      '<ol><li><p></p></li><li><p></p></li></ol><blockquote><p>a</p></blockquote>',
      '<ul><li><p></p><pre><code>x</code></pre></li><li><p></p></li></ul><p>Outro.</p>',
    ]) {
      const editor = open('');
      paste(editor, html, 'text/html');
      const saved = getMarkdown(editor);
      expect(saved).not.toMatch(/^\d+\. \n\n|^- \n\n/);
      expect(getMarkdown(open(saved))).toBe(saved);
    }
  });

  // The facts the matrix's named exceptions rest on, shown on items main loads the same way.
  it('an item’s first paragraph before another block cannot become a heading, lead or not', () => {
    for (const source of ['- a\n  > q', '- > q']) {
      const editor = open(source);
      const count = changes(editor);
      editor.commands.setTextSelection(source.startsWith('- a') ? find(editor, 'a') : lead(editor));
      editor.commands.toggleHeading({ level: 2 });
      expect(count()).toBe(0);
    }
  });

  it('text pasted from a tight item with a nested list gets a trailing hard break, lead or not', () => {
    for (const source of ['- a\n  - b', '- a\n  - > b']) {
      const from = open(source);
      from.view.dispatch(from.state.tr.setSelection(new AllSelection(from.state.doc)));
      const { text } = from.view.serializeForClipboard(from.state.selection.content());
      expect(text).toBe(source);
      const target = open('');
      paste(target, text);
      const breaks: string[] = [];
      target.state.doc.descendants((node) => {
        if (node.type.name === 'hardBreak') breaks.push(node.type.name);
      });
      expect(breaks).toEqual(['hardBreak']);
      expect(getMarkdown(target)).toBe(source);
    }
  });
});
