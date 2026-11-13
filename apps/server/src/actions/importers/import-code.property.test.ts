import { fencedMarkdownLines } from '@nibleaf/shared/markdown-code';
import MarkdownIt from 'markdown-it';
import { expect, it } from 'vitest';
import { convertGitBookMarkdown } from './gitbook-markdown';
import { importCodeLines } from './import-markdown-code';
import { rewriteMintlifyInternalLinks } from './mintlify-links';
import { normalizeMintlifyMdx } from './mintlify-mdx';

const SEED = 0x58_23_6b_09;
const CASES = 3072;

it('protects main code and exposes following prose across generated containers (seed 0x58236b09)', ({ task }) => {
  let state = SEED;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const choose = <T>(values: readonly [T, ...T[]]): T => values[next() % values.length] ?? values[0];
  const failures: Array<{ index: number; reason: string; source: string }> = [];
  const oracleOverruns: number[] = [];
  const overrunKinds = new Map<string, number>();
  const started = performance.now();
  for (let index = 0; index < CASES; index++) {
    const parts = Array.from({ length: next() % 4 }, () => choose(['>', '> ', '>\t', '- ', '1. ', '\t'] as const));
    const prefix = parts.join('');
    const continuation = parts.map((part) => (part === '- ' ? '  ' : part === '1. ' ? '   ' : part === '>' ? '> ' : part)).join('');
    const marker = choose(['`', '~'] as const);
    const length = 3 + (next() % 3);
    const closer = marker.repeat(length + (next() % (6 - length)));
    const falseCloser = choose(['none', 'wrong character', 'too short', 'new quote', 'new list'] as const);
    const falseLine =
      falseCloser === 'none'
        ? []
        : [
            continuation +
              (falseCloser === 'new quote' ? '> ' : falseCloser === 'new list' ? '- ' : '') +
              (falseCloser === 'wrong character' ? (marker === '`' ? '~' : '`') : marker).repeat(falseCloser === 'too short' ? length - 1 : length),
            `${continuation}[Still literal](/literal)`,
          ];
    const selectedWrapper = choose(['none', 'single-line', 'multiline', 'self-closing'] as const);
    // Indented examples are ordinary Markdown; MDX child indentation is
    // structural and is exercised by the wrapped fenced examples instead.
    const wrapper = index % 5 === 0 ? 'none' : selectedWrapper;
    const opening =
      wrapper === 'single-line'
        ? ['<CodeGroup>']
        : wrapper === 'multiline'
          ? ['<CodeGroup', '  title="Example > sample"', '>']
          : wrapper === 'self-closing'
            ? ['<Example', '  title="Literal />"', '/>']
            : [];
    const closing = wrapper === 'single-line' || wrapper === 'multiline' ? ['</CodeGroup>'] : [];
    const example =
      index % 5 === 0
        ? [`${prefix}Example:`, '', `${continuation}    [Literal](/literal)`, `${continuation}    /`]
        : [`${prefix}${marker.repeat(length)}md`, `${continuation}[Literal](/literal)`, ...falseLine, `${continuation}${closer}`];
    const sentinel = `[Sentinel ${index}](/sentinel)`;
    const codeExample = [...opening, ...example].join('\n');
    const source = [...opening, ...example, ...closing, '', sentinel].join('\n');
    // The shared reader scanner (`fencedMarkdownLines`) is an independent
    // oracle for every line of the generated code example.
    const oracle = fencedMarkdownLines(codeExample.split('\n'));
    const protectedLines = importCodeLines(source);
    if (index % 5 === 0 && !protectedLines[opening.length + 2]) failures.push({ index, reason: 'indented code is exposed', source });
    const oracleOverrun = Boolean(fencedMarkdownLines(source.split('\n')).at(-1));
    if (oracleOverrun) {
      oracleOverruns.push(index);
      overrunKinds.set(falseCloser, (overrunKinds.get(falseCloser) ?? 0) + 1);
    }
    // Until #587 the shared scanner lost fences in quotes and lists, reopened at
    // a real closer and flagged the following prose: it over-protected 606 of
    // these articles. It now tracks containers and overruns none; the count is
    // pinned at 0 below. (a) compares ALL oracle code-example lines, without filtering;
    // (b) independently checks prose on the complete, correctly closed article.
    if (oracle.some((code, line) => code && !protectedLines[line])) failures.push({ index, reason: 'main code is exposed', source });
    if (protectedLines.at(-1)) failures.push({ index, reason: 'sentinel is protected', source });
    for (const [name, convert] of [
      ['GitBook', (value: string) => convertGitBookMarkdown(value, { resolveFile: () => undefined }).content],
      ['Mintlify', normalizeMintlifyMdx],
    ] as const) {
      const content = rewriteMintlifyInternalLinks(convert(source), 'intro', new Map([['sentinel', '/rewritten']]));
      if (!content.includes(`[Sentinel ${index}](/rewritten)`)) failures.push({ index, reason: `${name} does not rewrite prose`, source });
    }
  }
  const runtimeMs = Math.round(performance.now() - started);
  console.info(`import-code property: ${CASES} cases, ${runtimeMs}ms, oracle overruns=${oracleOverruns.length}`);
  Object.assign(task.meta, {
    scannerProperty: {
      seed: `0x${SEED.toString(16)}`,
      cases: CASES,
      runtimeMs,
      oracleOverruns: oracleOverruns.length,
      overrunKinds: Object.fromEntries(overrunKinds),
    },
  });
  // The shared scanner over-protected 606 articles before #587 and none since.
  expect(oracleOverruns).toHaveLength(0);
  expect(failures.slice(0, 12), `${failures.length} failures; seed=0x${SEED.toString(16)}`).toEqual([]);
}, 20_000);

it('ends generated unclosed container fences inside components (seed 0x58236b09)', ({ task }) => {
  let state = SEED;
  const started = performance.now();
  const cases = 256;
  const failures: number[] = [];
  for (let index = 0; index < cases; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const [opening, continuation] = (
      [
        ['> ', '> '],
        ['- ', '  '],
        ['1. ', '   '],
        ['- > ', '  > '],
      ] as const
    )[(state >>> 0) % 4] ?? ['> ', '> '];
    const marker = ((state >>> 0) % 2 ? '`' : '~').repeat(3 + ((state >>> 0) % 3));
    const source = `<CodeGroup>\n    ${opening}${marker}md\n    ${continuation}[Literal](/literal)\n</CodeGroup>\n\n[After](/next)`;
    const oracle = fencedMarkdownLines(source.split('\n'));
    const actual = importCodeLines(source);
    if (oracle.some((code, line) => code !== Boolean(actual[line]))) failures.push(index);
    for (const convert of [(value: string) => convertGitBookMarkdown(value, { resolveFile: () => undefined }).content, normalizeMintlifyMdx]) {
      const content = rewriteMintlifyInternalLinks(convert(source), 'intro', new Map([['next', '/rewritten']]));
      if (!content.includes('[After](/rewritten)') || !content.includes('[Literal](/literal)')) failures.push(index);
    }
  }
  const runtimeMs = Math.round(performance.now() - started);
  Object.assign(task.meta, { containerProperty: { seed: SEED, cases, runtimeMs } });
  console.info(`unclosed container property: ${cases} cases, ${runtimeMs}ms`);
  expect(failures).toEqual([]);
});

it('protects markdown-it code across blank quote lines in unclosed quoted lists (seed 0x58236b09)', ({ task }) => {
  let state = SEED;
  const cases = 256;
  const started = performance.now();
  const parser = new MarkdownIt({ html: true });
  const failures: number[] = [];
  for (let index = 0; index < cases; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const quotes = '> '.repeat(1 + ((state >>> 0) % 3));
    const ordered = (state >>> 0) % 2 === 1;
    const marker = ((state >>> 0) % 2 ? '`' : '~').repeat(3 + ((state >>> 0) % 3));
    const continuation = quotes + (ordered ? '   ' : '  ');
    const body = [
      `${quotes}${ordered ? '1. ' : '- '}${marker}md`,
      `${continuation}[Literal](/literal)`,
      quotes.trimEnd(),
      `${continuation}[Still literal](/literal)`,
    ];
    // markdown-it sees CommonMark after removing MDX's structural indentation.
    // Blank delimiters keep the wrapper's HTML block separate from its body.
    const oracleSource = ['<CodeGroup>', '', ...body, '</CodeGroup>', '', '[After](/next)'].join('\n');
    const source = ['<CodeGroup>', '', ...body.map((line) => `    ${line}`), '</CodeGroup>', '', '[After](/next)'].join('\n');
    const actual = importCodeLines(source);
    const code = parser.parse(oracleSource, {}).filter((token) => token.type === 'fence' || token.type === 'code_block');
    if (!code.length) failures.push(index);
    for (const token of code) {
      if (!token.map) continue;
      for (let line = token.map[0]; line < token.map[1]; line++) if (!actual[line]) failures.push(index);
    }
    for (const convert of [(value: string) => convertGitBookMarkdown(value, { resolveFile: () => undefined }).content, normalizeMintlifyMdx]) {
      const content = rewriteMintlifyInternalLinks(
        convert(source),
        'intro',
        new Map([
          ['literal', '/changed'],
          ['next', '/rewritten'],
        ]),
      );
      if (content.includes('/changed') || !content.includes('[After](/rewritten)')) failures.push(index);
    }
  }
  const runtimeMs = Math.round(performance.now() - started);
  Object.assign(task.meta, { quotedListProperty: { seed: SEED, cases, runtimeMs } });
  console.info(`quoted list blank property: ${cases} cases, ${runtimeMs}ms`);
  expect(failures).toEqual([]);
});
