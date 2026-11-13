import { createHash } from 'node:crypto';
import { fencedMarkdownLines } from '@nibleaf/shared/markdown-code';
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
    // This shared scanner is byte-identical to main 93408093. Keep it as an
    // independent oracle for every line of the generated code example.
    const oracle = fencedMarkdownLines(codeExample.split('\n'));
    const protectedLines = importCodeLines(source);
    if (index % 5 === 0 && !protectedLines[opening.length + 2]) failures.push({ index, reason: 'indented code is exposed', source });
    const oracleOverrun = Boolean(fencedMarkdownLines(source.split('\n')).at(-1));
    if (oracleOverrun) {
      oracleOverruns.push(index);
      overrunKinds.set(falseCloser, (overrunKinds.get(falseCloser) ?? 0) + 1);
    }
    // Main can reopen at a real closer and incorrectly flag following prose.
    // Report and pin that existing full-article limit instead of making it a
    // requirement: (a) compares ALL oracle code-example lines, without filtering;
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
  Object.assign(task.meta, {
    scannerProperty: {
      seed: `0x${SEED.toString(16)}`,
      cases: CASES,
      runtimeMs,
      oracleOverruns: oracleOverruns.length,
      overrunKinds: Object.fromEntries(overrunKinds),
    },
  });
  expect(oracleOverruns).toHaveLength(606);
  expect(createHash('sha256').update(oracleOverruns.join(',')).digest('hex')).toBe(
    '6c8f4844c08ba09312743ce66e36ff5986603630ff723a66d5b87f78e3232422',
  );
  expect(failures.slice(0, 12), `${failures.length} failures; seed=0x${SEED.toString(16)}`).toEqual([]);
}, 20_000);
