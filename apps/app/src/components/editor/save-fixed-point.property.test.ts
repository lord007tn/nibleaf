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
 * in a list item or in a component. After five load/save cycles the page is no
 * longer than it was, and one more cycle changes nothing. The generator is the
 * xorshift and seed of `container-fences.property.test.ts`.
 */

const SEED = 0x58_23_6b_09;
const COUNT = 256;
const CYCLES = 5;

type Kind = 'unclosed fence' | 'fence in a component' | 'unterminated raw text';
const KINDS: readonly [Kind, ...Kind[]] = ['unclosed fence', 'fence in a component', 'unterminated raw text'];

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
    } else if (kind === 'fence in a component') {
      const indent = choose(['', '  ', '    ', '      ']);
      const code = fence(indent, next() % 4 !== 0);
      const text = flip() ? `${locale.text}\n\n` : '';
      // `blank`: the editor's layout, a blank line around every tag and block.
      // `none`: no blank line, one HTML block to markdown-it, kept whole. `issue`:
      // the #603 layout, adjacent tags with blank lines around the content.
      const layout = choose(['blank', 'none', 'issue'] as const);
      const gap = layout === 'none' ? '\n' : '\n\n';
      const tagGap = layout === 'blank' ? '\n\n' : '\n';
      const content = layout === 'none' ? `${text.replace('\n\n', '\n')}${code}` : `${text}${code}`;
      const component = choose(['Steps', 'Step', 'Frame', 'CodeGroup', 'Note', 'Note in a Step', 'list item in a Step'] as const);
      if (component === 'Steps') block = `<Steps>${tagGap}<Step title="One">${gap}${content}${gap}</Step>${tagGap}</Steps>`;
      else if (component === 'Note in a Step') block = `<Step title="One">${gap}<Note>${gap}${content}${gap}</Note>${gap}</Step>`;
      else if (component === 'list item in a Step')
        block = `<Step title="One">${gap}- ${locale.item}\n\n  ${code.replaceAll('\n', '\n  ')}${gap}</Step>`;
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

  it(`never grows ${COUNT} generated pages over ${CYCLES} load/save cycles, and ends at a fixed point`, () => {
    const cases = generatedCases();
    const started = performance.now();
    let saves = 0;
    const failures: Array<{ index: number; kind: Kind; source: string; saved: string; again: string }> = [];
    for (const { index, kind, source } of cases) {
      let saved = source;
      let again = source;
      // A save is a function of the page alone, so once a cycle changes nothing,
      // no later one does: the rest of the five are that same page.
      for (let cycle = 0; cycle <= CYCLES; cycle++) {
        again = save(saved);
        saves++;
        if (again === saved) break;
        saved = again;
      }
      if (saved.length > source.length || again !== saved) failures.push({ index, kind, source, saved, again });
    }
    const seconds = (performance.now() - started) / 1000;
    console.info(`save fixed-point property: ${cases.length} cases, ${saves} saves, ${seconds.toFixed(2)} s`);
    expect(failures.slice(0, 3)).toEqual([]);
    expect(new Set(cases.map((item) => item.kind)).size).toBe(KINDS.length);
  }, 30_000);
});
