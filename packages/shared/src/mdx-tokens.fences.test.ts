import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { fencedMarkdownLines, markdownLineKinds } from './markdown-code';
import { type MdxToken, tokenizeMdx } from './mdx-tokens';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';
import {
  CODERABBIT_REPROS,
  CONTINUATION_FENCE_REPROS,
  FENCE_CONTAINER_REPROS,
  fenceCases,
  INDENTED_FENCE_AFTER_QUOTE,
  LAZY_INLINE_HTML_REPROS,
  LAZY_TEXT_AFTER_INLINE_HTML,
} from './testing/fence-cases';

const components = new Set(['note', 'codegroup', 'tabs', 'tab']);
const tokenSource = (token: MdxToken) => (token.kind === 'open' || token.kind === 'close' ? token.raw : token.value);

/** Recover source offsets from lossless tokens, counting only block code:
 * inline code can legitimately occur on a line the fence scanner calls prose. */
const blockCodeLines = (source: string, tokens: MdxToken[]) => {
  expect(tokens.map(tokenSource).join('')).toBe(source);
  const flags = source.split('\n').map(() => false);
  let line = 0;
  for (const token of tokens) {
    const value = tokenSource(token);
    const breaks = value.split('\n').length - 1;
    if (token.kind === 'code' && token.block) for (let at = line; at <= line + breaks; at++) flags[at] = true;
    line += breaks;
  }
  return flags;
};

it('uses the reader boundaries for all #587 and #590 repros, keeping the following Note as a component', () => {
  const repros = [
    ...FENCE_CONTAINER_REPROS,
    ...CONTINUATION_FENCE_REPROS,
    ...CODERABBIT_REPROS,
    ...LAZY_INLINE_HTML_REPROS,
    ['indented fence after a quote', INDENTED_FENCE_AFTER_QUOTE],
    ['lazy text after inline HTML', LAZY_TEXT_AFTER_INLINE_HTML.source],
    ['HTML block fence lookalike', '<div>\n```md\n# literal\n```\n</div>'],
  ];
  const failures: string[] = [];
  for (const [name, example] of repros) {
    const source = `${example}\n\n<Note>After</Note>`;
    const tokens = tokenizeMdx(source, components);
    const actual = blockCodeLines(source, tokens);
    const kinds = markdownLineKinds(source.split('\n'));
    const expected = fencedMarkdownLines(source.split('\n'));
    // HTML has an export-only literal-example exception; all non-HTML fence
    // boundaries still come from the reader.
    if (actual.some((flag, line) => kinds[line] !== 'html' && flag !== expected[line])) failures.push(`${name}: code lines`);
    if (!tokens.some((token) => token.kind === 'open' && token.name === 'note' && token.raw === '<Note>')) failures.push(`${name}: Note`);
  }
  expect(failures).toEqual([]);
  expect(tokenizeMdx('```md\n<Note>Still literal</Note>', components)).toEqual([
    { kind: 'code', value: '```md\n<Note>Still literal</Note>', block: true },
  ]);
  // Inline code stays protected, and HTML examples never become MDX components.
  const htmlTokens = tokenizeMdx('<div>\n`inline` <Note>Inside</Note> H<sub>2</sub>\n</div>', components);
  expect(htmlTokens).toContainEqual({ kind: 'code', value: '`inline`', block: false });
  expect(htmlTokens.some((token) => token.kind === 'open' && token.name === 'note')).toBe(false);
  expect(htmlTokens.some((token) => token.kind === 'open' && token.name === 'sub')).toBe(true);
});

it('matches the reader on all 3,072 generated sources (seed 0x58236b09)', () => {
  const start = performance.now();
  const cases = fenceCases();
  const failures: number[] = [];
  for (const { index, source } of cases) {
    const expected = fencedMarkdownLines(source.split('\n'));
    if (blockCodeLines(source, tokenizeMdx(source, components)).some((flag, line) => flag !== expected[line])) failures.push(index);
  }
  console.info(`MDX/reader differential: ${cases.length} cases in ${(performance.now() - start).toFixed(1)} ms; ${failures.length} differ`);
  expect(cases).toHaveLength(3072);
  expect(failures.slice(0, 12), `${failures.length} disagreements`).toEqual([]);
});

it('exports the affected page with literal reader code and the projected callout after it', () => {
  const example = FENCE_CONTAINER_REPROS[0]?.[1] as string;
  const source = `${example}\n\n<Note>After</Note>`;
  for (const project of [normalizePublicMarkdownContent, portablePublicMdxMarkdown]) {
    const output = project(source);
    expect(output).toBe(`${example}\n\n> After`);
    expect(fencedMarkdownLines(output.split('\n'))).toEqual(fencedMarkdownLines(source.split('\n')));
  }
});
