// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * No page grows when it is opened and saved again and again (#602, #603, #576).
 * Generated pages hold unclosed fences (on the page, in list items and quotes;
 * backticks or tildes, openers of 3 to 5, no closer or one too short or of the
 * other character, with or without a last line break), components (`<Steps>` and
 * `<Step>`, `<Frame>`, `<CodeGroup>`, `<Note>`) holding fences indented 0 to 6
 * columns, closed or not, with blank lines around their tags or none, some nested
 * (a Note or a list item in a Step), and unterminated raw-text elements on the page,
 * in a list item or in a component; and unclosed fences in quotes and list items
 * ending in lines blank inside them, or followed by whitespace-only lines through
 * the end of the page. After the first save and after five load/save cycles the
 * page is no longer than it was, the fences followed by whitespace lines save back
 * exactly as written, and one more save changes nothing. The generator is the
 * xorshift and seed of `container-fences.property.test.ts`.
 */

const SEED = 0x58_23_6b_09;
const COUNT = 320;
const CYCLES = 5;

type Kind =
  | 'unclosed fence'
  | 'fence in a component'
  | 'unterminated raw text'
  | 'unclosed fence ending in container blanks'
  | 'unclosed fence then whitespace lines';
const KINDS: readonly [Kind, ...Kind[]] = [
  'unclosed fence',
  'fence in a component',
  'unterminated raw text',
  'unclosed fence ending in container blanks',
  'unclosed fence then whitespace lines',
];
/** Kinds that must save back exactly as written, not only no longer. */
const EXACT: ReadonlySet<Kind> = new Set(['unclosed fence then whitespace lines']);
/** Whitespace-only lines that may follow a fence at the end of the page. */
const WHITESPACE_LINES = ['', ' ', '  ', '   ', '    ', '\t', ' \t', '\t ', '  \t  '] as const;

/** Containers for a fence whose last lines are blank inside them: the opening
 *  line's prefix (a list item's marker), the prefix of its other lines, and the
 *  spellings of a blank line there. */
const BLANK_CONTAINERS = [
  { head: '', first: '> ', prefix: '> ', blanks: ['> ', '>'] },
  { head: '', first: '>', prefix: '>', blanks: ['>', '> '] },
  { head: '', first: '> > ', prefix: '> > ', blanks: ['> > ', '> >'] },
  { head: '', first: '- ', prefix: '  ', blanks: ['  ', '   '] },
  { head: '- {item}\n\n', first: '  ', prefix: '  ', blanks: ['  '] },
  { head: '', first: '> - ', prefix: '>   ', blanks: ['>   ', '>', '> '] },
] as const;

const LOCALES = [
  { before: 'Intro.', after: 'Outro.', item: 'Item', text: 'Install it:' },
  { before: 'مقدمة الصفحة.', after: 'خاتمة الصفحة.', item: 'عنصر', text: 'ثبّته أولاً:' },
] as const;

const CODE = ['const a = 1;', '<Card title="x" />', '</Step>', '<iframe src="x"></iframe>', '- not a list', '', '  indented();'] as const;
const BODY = ['<b>KEEP</b>', '**not bold**', '# not a heading', '<!-- not a comment', '</Note>', 'x = 1;'] as const;

interface GeneratedCase {
  index: number;
  kind: Kind;
  source: string;
}

function generatedCases(seed = SEED, count = COUNT): GeneratedCase[] {
  let state = seed;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const choose = <V>(values: readonly V[]): V => values[next() % values.length] as V;
  const flip = () => next() % 2 === 0;
  const lines = <V extends string>(values: readonly V[], most: number) => Array.from({ length: 1 + (next() % most) }, () => choose(values));

  const fence = (indent: string, closed: boolean) => {
    const marker = choose(['`', '~'] as const);
    const length = 3 + (next() % 3);
    const closer = closed
      ? marker.repeat(length + (next() % 2))
      : choose(['', marker.repeat(length - 1), (marker === '`' ? '~' : '`').repeat(length)]);
    const body = [`${marker.repeat(length)}${choose(['', 'js', 'md'])}`, ...lines(CODE, 3)];
    if (closer) body.push(closer);
    return body.map((line) => (line ? `${indent}${line}` : line)).join('\n');
  };

  const cases: GeneratedCase[] = [];
  for (let index = 0; index < count; index++) {
    const kind = KINDS[index % KINDS.length] as Kind;
    const locale = choose(LOCALES);
    let block: string;
    if (kind === 'unclosed fence') {
      const where = choose(['page', 'list item', 'list continuation', 'quote', 'quote in a list item'] as const);
      const raw = fence('', false);
      const indented = (prefix: string) =>
        raw
          .split('\n')
          .map((line) => `${prefix}${line}`)
          .join('\n');
      if (where === 'page') block = raw;
      else if (where === 'list item') block = `- ${indented('  ').slice(2)}${flip() ? `\n- ${locale.item}` : ''}`;
      else if (where === 'list continuation') block = `- ${locale.item}\n\n${indented('  ')}`;
      else if (where === 'quote') block = indented('> ');
      else block = `- ${locale.item}\n\n${indented('  > ')}`;
      if (where !== 'page' && flip()) block += `\n\n${locale.after}`;
      block += choose(['', '\n', '\n\n']);
    } else if (kind === 'unclosed fence ending in container blanks') {
      const container = choose(BLANK_CONTAINERS);
      const marker = choose(['`', '~'] as const).repeat(3 + (next() % 3));
      const code = lines(['a', 'const a = 1;', '</Step>', '<Card title="x" />'] as const, 2);
      const blanks = Array.from({ length: 1 + (next() % 2) }, () => choose(container.blanks));
      block = [
        `${container.head.replace('{item}', locale.item)}${container.first}${marker}${choose(['', 'js'])}`,
        ...code.map((line) => `${container.prefix}${line}`),
        ...blanks,
      ].join('\n');
      block += choose(['', '\n']);
    } else if (kind === 'unclosed fence then whitespace lines') {
      // The same containers, then one to three whitespace-only lines through the
      // end of the page: markdown-it reads the last of them outside the container.
      const container = choose(BLANK_CONTAINERS);
      const marker = choose(['`', '~'] as const).repeat(3 + (next() % 3));
      const code = lines(['a', 'const a = 1;', '</Step>'] as const, 2);
      const trailing = Array.from({ length: 1 + (next() % 3) }, () => choose(WHITESPACE_LINES));
      if (trailing[trailing.length - 1] === '') trailing[trailing.length - 1] = '   ';
      block = [
        `${container.head.replace('{item}', locale.item)}${container.first}${marker}${choose(['', 'js'])}`,
        ...code.map((line) => `${container.prefix}${line}`),
        ...trailing,
      ].join('\n');
      block += choose(['', '\n']);
    } else if (kind === 'fence in a component') {
      const indent = choose(['', '  ', '    ', '      ']);
      const code = fence(indent, next() % 4 !== 0);
      const text = flip() ? `${locale.text}\n\n` : '';
      // `blank`: the editor's layout, a blank line around every tag and block.
      // `none`: no blank line, one HTML block to markdown-it, kept whole. `issue`:
      // the #603 layout, adjacent tags with blank lines around the content, only with
      // a fence indented four columns or more (kept whole): around content the editor
      // holds, it writes its own blank lines between adjacent tags on the first save,
      // a known layout change of its own that doesn't grow.
      const layout = choose(indent.length >= 4 ? (['blank', 'none', 'issue'] as const) : (['blank', 'none'] as const));
      const gap = layout === 'none' ? '\n' : '\n\n';
      const tagGap = layout === 'blank' ? '\n\n' : '\n';
      const content = layout === 'none' ? `${text.replace('\n\n', '\n')}${code}` : `${text}${code}`;
      const component = choose(['Steps', 'Step', 'Frame', 'CodeGroup', 'Note', 'Note in a Step', 'list item in a Step'] as const);
      if (component === 'Steps') block = `<Steps>${tagGap}<Step title="One">${gap}${content}${gap}</Step>${tagGap}</Steps>`;
      else if (component === 'Note in a Step') block = `<Step title="One">${gap}<Note>${gap}${content}${gap}</Note>${gap}</Step>`;
      // Lines straight after a tag, before a blank line, are one HTML block to
      // markdown-it and lose their Markdown with or without a fence (as in
      // container-fences.property.test.ts), so the list item gets the editor's
      // layout: a blank line on each side.
      else if (component === 'list item in a Step') block = `<Step title="One">\n\n- ${locale.item}\n\n  ${code.replaceAll('\n', '\n  ')}\n\n</Step>`;
      else block = `<${component}${component === 'Frame' ? ' caption="Code"' : ''}>${gap}${content}${gap}</${component}>`;
    } else {
      const tag = choose(['script', 'style', 'textarea', 'title'] as const);
      const element = `<${tag}>${lines(BODY, 3).join('\n')}`;
      const where = choose(['start', 'middle', 'end', 'list item', 'component'] as const);
      if (where === 'list item') block = `- ${locale.item}\n\n  ${element.replaceAll('\n', '\n  ')}\n\n- ${locale.item}`;
      else if (where === 'component') block = `<Note>\n\n${element}\n\n</Note>`;
      else if (where === 'middle') block = `${element}\n\n${locale.after}\n\n## ${locale.item}`;
      else block = element;
      if (where === 'start') {
        cases.push({ index, kind, source: block });
        continue;
      }
    }
    cases.push({ index, kind, source: `${locale.before}\n\n${block}` });
  }
  return cases;
}

describe('pages that end in unclosed or unread blocks, generated', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  afterAll(() => editor.destroy());
  const save = (markdown: string) => {
    editor.commands.setContent(markdown, { emitUpdate: false });
    return getMarkdown(editor);
  };

  it(`never grows ${COUNT} generated pages, on the first save or over ${CYCLES} load/save cycles, and ends at a fixed point`, () => {
    const cases = generatedCases();
    const started = performance.now();
    let saves = 0;
    const failures: Array<{ index: number; kind: Kind; source: string; first: string; saved: string; again: string }> = [];
    for (const { index, kind, source } of cases) {
      let saved = source;
      let first = '';
      // A save is a function of the page alone, so once a cycle changes nothing,
      // no later one does: the rest of the five are that same page.
      for (let cycle = 0; cycle < CYCLES; cycle++) {
        const next = save(saved);
        saves++;
        if (cycle === 0) first = next;
        if (next === saved) break;
        saved = next;
      }
      // One more save, apart from the cycles, must change nothing.
      const again = save(saved);
      saves++;
      const exact = !EXACT.has(kind) || saved === source;
      if (first.length > source.length || saved.length > source.length || again !== saved || !exact)
        failures.push({ index, kind, source, first, saved, again });
    }
    const seconds = (performance.now() - started) / 1000;
    console.info(`save fixed-point property: ${cases.length} cases, ${saves} saves, ${seconds.toFixed(2)} s`);
    expect(failures.slice(0, 3)).toEqual([]);
    expect(new Set(cases.map((item) => item.kind)).size).toBe(KINDS.length);
  }, 30_000);
});
