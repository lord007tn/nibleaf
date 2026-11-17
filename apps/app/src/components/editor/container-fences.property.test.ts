// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * Generated pages with a code fence in list items and quotes: bullet, ordered and
 * nested lists, quotes, a quote in a list and a list in a quote, the fence on the
 * item's first line or on a continuation line, container prefixes written with
 * spaces, tabs or no space after `>`, `<CodeGroup>` around the block (with blank
 * lines, which the editor reads as Markdown, or without, which it keeps whole),
 * and closers as long as the opener or longer. Each page saves back byte for byte,
 * and saving that again gives the same bytes (#578, #589). The generator is the
 * xorshift and seed of `@nibleaf/shared/testing/fence-cases` (#582).
 */

const SEED = 0x58_23_6b_09;
const COUNT = 256;

type Shape =
  | 'bullet, first line'
  | 'ordered, first line'
  | 'bullet, continuation'
  | 'ordered, continuation'
  | 'nested, first line'
  | 'nested, continuation'
  | 'quote'
  | 'quote in a list item'
  | 'list item in a quote, first line'
  | 'list item in a quote, continuation';

const SHAPES: readonly [Shape, ...Shape[]] = [
  'bullet, first line',
  'ordered, first line',
  'bullet, continuation',
  'ordered, continuation',
  'nested, first line',
  'nested, continuation',
  'quote',
  'quote in a list item',
  'list item in a quote, first line',
  'list item in a quote, continuation',
];

/** Each shape's lines around the fence, and the prefixes a fence line may carry:
 *  the canonical one first, then the same containers written with tabs (or `>`
 *  with no space, before text). `first` is the opening line's prefix when the fence
 *  opens on its item's first line. */
const LAYOUT: Record<Shape, { head: string[]; tail: string[]; first?: string; prefixes: readonly [string, ...string[]]; blank: string }> = {
  'bullet, first line': { head: [], tail: ['- {next}'], first: '- ', prefixes: ['  ', '\t'], blank: '' },
  'ordered, first line': { head: [], tail: ['2. {next}'], first: '1. ', prefixes: ['   ', '\t'], blank: '' },
  'bullet, continuation': { head: ['- {item}', ''], tail: ['', '- {next}'], prefixes: ['  ', '\t'], blank: '' },
  'ordered, continuation': { head: ['1. {item}', ''], tail: ['', '2. {next}'], prefixes: ['   ', '\t'], blank: '' },
  'nested, first line': { head: ['- {item}', ''], tail: ['  - {next}'], first: '  - ', prefixes: ['    ', '\t', '  \t'], blank: '' },
  'nested, continuation': { head: ['- {item}', '', '  - {item}', ''], tail: [], prefixes: ['    ', '\t', '  \t'], blank: '' },
  quote: { head: [], tail: [], prefixes: ['> ', '>\t', '>'], blank: '>' },
  'quote in a list item': { head: ['- {item}', ''], tail: [], prefixes: ['  > ', '\t> ', '  >\t', '\t>'], blank: '  >' },
  'list item in a quote, first line': { head: [], tail: ['> - {next}'], first: '> - ', prefixes: ['>   ', '>\t', '> \t'], blank: '>' },
  'list item in a quote, continuation': { head: ['> - {item}', '>'], tail: [], prefixes: ['>   ', '>\t', '> \t'], blank: '>' },
};

const CODE = [
  '<iframe src="x"></iframe>',
  'const a = 1;',
  '<Card title="x" />',
  '[Tour](https://youtu.be/abcdefghijk)',
  '  indented();',
  '- not a list',
  '> not a quote',
  '',
] as const;

interface Locale {
  before: string;
  after: string;
  item: string;
  next: string;
}

const LOCALES: readonly [Locale, ...Locale[]] = [
  { before: 'Intro.', after: 'Outro.', item: 'Item', next: 'Next' },
  { before: 'مقدمة الصفحة.', after: 'خاتمة الصفحة.', item: 'عنصر', next: 'التالي' },
];

interface ContainerCase {
  index: number;
  shape: Shape;
  wrapper: 'none' | 'CodeGroup' | 'tight CodeGroup';
  source: string;
}

function containerCases(seed = SEED, count = COUNT): ContainerCase[] {
  let state = seed;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const choose = <T>(values: readonly [T, ...T[]]): T => values[next() % values.length] ?? values[0];
  const cases: ContainerCase[] = [];
  for (let index = 0; index < count; index++) {
    const shape = choose(SHAPES);
    const layout = LAYOUT[shape];
    const locale = choose(LOCALES);
    // Tabs and the other spellings on some lines, or none.
    const spelling = choose(['spaces', 'tabs', 'mixed'] as const);
    const prefix = (text: string): string => {
      if (text === '') return layout.blank;
      if (spelling === 'spaces') return layout.prefixes[0];
      const choices = layout.prefixes.slice(1).filter((value) => !(value === '>' && text.startsWith(' ')));
      const spelled = choices[next() % choices.length] ?? layout.prefixes[0];
      return spelling === 'tabs' || next() % 2 === 0 ? spelled : layout.prefixes[0];
    };
    const marker = choose(['`', '~'] as const);
    const length = 3 + (next() % 3);
    const closer = marker.repeat(length + (next() % 3));
    const language = choose(['', 'js', 'html', 'md'] as const);
    const code = Array.from({ length: 1 + (next() % 3) }, () => choose(CODE));
    if (code[0] === '') code[0] = 'const a = 1;';
    const openLine = `${marker.repeat(length)}${language}`;
    const fence = [
      layout.first ? `${layout.first}${openLine}` : `${prefix(openLine)}${openLine}`,
      ...code.map((line) => `${prefix(line)}${line}`),
      `${prefix(closer)}${closer}`,
    ];
    const fill = (line: string) => line.replace('{item}', locale.item).replace('{next}', locale.next);
    const block = [...layout.head.map(fill), ...fence, ...layout.tail.map(fill)].join('\n');
    // Without blank lines around its children, a component is one HTML block to
    // markdown-it up to the first blank line; with the fence before that line, the
    // editor keeps the component whole. (Lines before a blank line there lose their
    // Markdown with or without a fence, so those pages aren't generated.)
    const wrapper = layout.head.includes('') ? choose(['none', 'CodeGroup'] as const) : choose(['none', 'CodeGroup', 'tight CodeGroup'] as const);
    const wrapped =
      wrapper === 'none' ? block : wrapper === 'CodeGroup' ? `<CodeGroup>\n\n${block}\n\n</CodeGroup>` : `<CodeGroup>\n${block}\n</CodeGroup>`;
    cases.push({ index, shape, wrapper, source: `${locale.before}\n\n${wrapped}\n\n${locale.after}` });
  }
  return cases;
}

describe('code fences in list items and quotes, generated', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  afterAll(() => editor.destroy());
  const save = (markdown: string) => {
    editor.commands.setContent(markdown, { emitUpdate: false });
    return getMarkdown(editor);
  };

  it(`saves ${COUNT} generated pages back byte for byte, and again unchanged`, () => {
    const cases = containerCases();
    const started = performance.now();
    const failures: Array<{ index: number; shape: Shape; wrapper: string; source: string; saved: string; again: string }> = [];
    for (const { index, shape, wrapper, source } of cases) {
      const saved = save(source);
      const again = save(saved);
      if (saved !== source || again !== saved) failures.push({ index, shape, wrapper, source, saved, again });
    }
    const seconds = (performance.now() - started) / 1000;
    console.info(`container fence property: ${cases.length} cases, ${seconds.toFixed(2)} s`);
    expect(failures.slice(0, 3)).toEqual([]);
    expect(new Set(cases.map((item) => item.shape)).size).toBe(SHAPES.length);
    expect(new Set(cases.map((item) => item.wrapper)).size).toBe(3);
    // About 3.5 s alone; the margin is for a busy CI runner.
  }, 30_000);
});
