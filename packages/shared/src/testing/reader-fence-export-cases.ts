import type { MdxToken } from '../mdx-tokens';

/**
 * #591's export family: fences main's tokenizer reads differently from the
 * published reader, each followed by a tail of prose, components, HTML,
 * braces or ESM. Main's outputs are committed in
 * `__fixtures__/mdx-tokens.reader-fences.main.json`.
 *
 * `reshaped` is decided here, from the shape alone, never by the code under
 * test: a callout line changes form only after a fence the reader closes with a
 * matching delimiter, when main kept that line as code, the line is a complete,
 * plain-text callout at the start of a line, and blank lines (or the end) sit
 * on both sides of it.
 */
export interface ReaderFenceExportCase {
  index: number;
  source: string;
  /** The callout lines whose form changes, as written. Empty for controls. */
  reshaped: string[];
  /** Text that must stay in the output, once each and in this order. */
  markers: string[];
}

interface FenceShape {
  name: string;
  lines: string[];
  /** The reader closes this fence with a matching delimiter, and main read that
   *  delimiter as an opener whose code runs on into the tail. */
  overrun: boolean;
}

/** #587's five repros plus three more of the same kind, then three controls. */
const FENCES: readonly FenceShape[] = [
  { name: 'ordered list quote (issue #591)', lines: ['1. >~~~md', '   > [Literal](/literal)', '   > ~~~'], overrun: true },
  { name: 'ordered list quote, `)` marker', lines: ['1) > ```md', '   > [Literal](/literal)', '   > ```'], overrun: true },
  { name: 'bullet list quote, longer closer', lines: ['- > ````md', '  > [Literal](/literal)', '  > `````'], overrun: true },
  { name: 'quote with a nested quote in the body', lines: ['> ```md', '> example', '> > ```', '> still code', '> ```'], overrun: true },
  { name: 'list item with a nested item in the body', lines: ['- ```md', '  example', '  - ```', '  still code', '  ```'], overrun: true },
  { name: 'tilde fence with a quoted false closer', lines: ['~~~~md', 'example', '> ~~~~', 'still code', '~~~~~'], overrun: true },
  { name: 'ordered list in two quotes, braces in the body', lines: ['1. > > ~~~md', '   > > {Literal}', '   > > ~~~'], overrun: true },
  { name: 'ordered list quote, other-marker fence in the body', lines: ['1. >~~~md', '   > ```js', '   > ~~~'], overrun: true },
  // Controls: the reader ends the fence by leaving its quote, or both scanners agree.
  { name: 'quote fence ended by leaving the quote (container exit)', lines: ['> ~~~md', '> [Literal](/literal)'], overrun: false },
  { name: 'closed top-level fence (both agree)', lines: ['~~~md', '[Literal](/literal)', '~~~'], overrun: false },
  { name: 'unclosed top-level fence (both agree)', lines: ['~~~md', '[Literal](/literal)'], overrun: false },
];

interface Tail {
  name: string;
  lines: string[];
  /** Lines that change form after an overrun fence. */
  reshaped: string[];
  markers: string[];
}

const TAILS: readonly Tail[] = [
  { name: 'note', lines: ['', '<Note>After</Note>'], reshaped: ['<Note>After</Note>'], markers: ['After'] },
  {
    name: 'note, then prose',
    lines: ['', '<Note>After</Note>', '', 'Closing words.'],
    reshaped: ['<Note>After</Note>'],
    markers: ['After', 'Closing words.'],
  },
  {
    name: 'warning',
    lines: ['', "<Warning>Mind the gap, it's real.</Warning>"],
    reshaped: ["<Warning>Mind the gap, it's real.</Warning>"],
    markers: ['Mind the gap'],
  },
  {
    name: 'two callouts',
    lines: ['', '<Note>After</Note>', '', '<Tip>Also this (twice).</Tip>'],
    reshaped: ['<Note>After</Note>', '<Tip>Also this (twice).</Tip>'],
    markers: ['After', 'Also this (twice).'],
  },
  {
    name: 'braces before the note',
    lines: ['', '{VISIBLE}', '', '<Note>After</Note>'],
    reshaped: ['<Note>After</Note>'],
    markers: ['{VISIBLE}', 'After'],
  },
  {
    name: 'ESM before the note',
    lines: ['', 'import Thing from "pkg"', '', '<Note>After</Note>'],
    reshaped: ['<Note>After</Note>'],
    markers: ['import Thing from "pkg"', 'After'],
  },
  {
    name: 'ESM after the note',
    lines: ['', '<Note>After</Note>', '', 'export const Value = 1;'],
    reshaped: ['<Note>After</Note>'],
    markers: ['After', 'export const Value = 1;'],
  },
  {
    name: 'inline component and link after the note',
    lines: ['', '<Note>After</Note>', '', 'See <Badge>New</Badge> and [Docs](/docs).'],
    reshaped: ['<Note>After</Note>'],
    markers: ['After', 'New', 'Docs'],
  },
  // Controls: nothing changes.
  { name: 'no blank line before', lines: ['<Note>After</Note>'], reshaped: [], markers: ['After'] },
  { name: 'lazy line after', lines: ['', '<Note>After</Note>', 'Lazy line.'], reshaped: [], markers: ['After', 'Lazy line.'] },
  { name: 'braces in the note', lines: ['', '<Note>{VISIBLE}</Note>'], reshaped: [], markers: ['{VISIBLE}'] },
  { name: 'HTML in the note', lines: ['', '<Note><b>After</b></Note>'], reshaped: [], markers: ['After'] },
  { name: 'active HTML in the note', lines: ['', '<Note><script>ACTIVE</script></Note>'], reshaped: [], markers: [] },
  { name: 'link in the note', lines: ['', '<Note>[After](/after)</Note>'], reshaped: [], markers: ['After'] },
  { name: 'attribute on the note', lines: ['', '<Note title="T">After</Note>'], reshaped: [], markers: ['After'] },
  { name: 'note over three lines', lines: ['', '<Note>', 'After', '</Note>'], reshaped: [], markers: ['After'] },
  { name: 'two notes on one line', lines: ['', '<Note>After</Note><Note>Again</Note>'], reshaped: [], markers: ['After', 'Again'] },
  { name: 'lowercase note', lines: ['', '<note>After</note>'], reshaped: [], markers: ['After'] },
  { name: 'indented note', lines: ['', '  <Note>After</Note>'], reshaped: [], markers: ['After'] },
  { name: 'unsupported callout name', lines: ['', '<Callout>After</Callout>'], reshaped: [], markers: ['After'] },
  { name: 'note starting with a list marker', lines: ['', '<Note>1. After</Note>'], reshaped: [], markers: ['After'] },
  { name: 'HTML block around the note', lines: ['', '<div>', '<Note>After</Note>', '</div>'], reshaped: [], markers: ['After'] },
  { name: 'HTML block before the note', lines: ['', '<div>', '', '<Note>After</Note>'], reshaped: [], markers: ['After'] },
  { name: 'active HTML before the note', lines: ['', '<script>ACTIVE</script>', '', '<Note>After</Note>'], reshaped: [], markers: ['After'] },
  { name: 'active HTML after the note', lines: ['', '<Note>After</Note>', '', '<style>p{}</style>'], reshaped: [], markers: ['After'] },
  { name: 'fence around the note', lines: ['', '~~~', '<Note>After</Note>', '~~~'], reshaped: [], markers: ['After'] },
  { name: 'fence after the note', lines: ['', '<Note>After</Note>', '', '```', 'code', '```'], reshaped: [], markers: ['After', 'code'] },
];

const BEFORE: ReadonlyArray<readonly string[]> = [[], ['Intro text.', ''], ['<Steps>', '']];

export const readerFenceExportCases = (): ReaderFenceExportCase[] => {
  const cases: ReaderFenceExportCase[] = [];
  for (const fence of FENCES)
    for (const tail of TAILS)
      for (const before of BEFORE)
        cases.push({
          index: cases.length,
          source: [...before, ...fence.lines, ...tail.lines].join('\n'),
          reshaped: fence.overrun ? tail.reshaped : [],
          markers: tail.markers,
        });
  return cases;
};

/** The lines a token stream keeps byte for byte as fenced code: the export's
 *  protection, read back from `tokenizeMdx`. Tokens concatenate to the source. */
export const protectedLines = (tokens: readonly MdxToken[], lineCount: number): boolean[] => {
  const lines = Array.from({ length: lineCount }, () => false);
  let line = 0;
  for (const token of tokens) {
    const value = 'raw' in token ? token.raw : token.value;
    const breaks = value.split('\n').length - 1;
    if (token.kind === 'code' && token.block) for (let at = line; at <= line + breaks; at++) lines[at] = true;
    line += breaks;
  }
  return lines;
};
