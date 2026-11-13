import { fencedMarkdownLines } from '@nibleaf/shared/markdown-code';
import {
  CODERABBIT_REPROS,
  CONTINUATION_FENCE_REPROS,
  continuationFenceCases,
  type DifferentialCategory,
  differentialCases,
  fenceCases,
  indentedLookalikeCases,
  ORDERED_LINE_UNDER_BULLET,
} from '@nibleaf/shared/testing/fence-cases';
import { mainFencedMarkdownLines } from '@nibleaf/shared/testing/markdown-code.main-reference';
import MarkdownIt from 'markdown-it';
import { expect, it } from 'vitest';

const markdown = new MarkdownIt({ html: true });

/** markdown-it's fence lines, and all its code lines (fences and indented code). */
const commonMarkCode = (lines: readonly string[]) => {
  const fence = lines.map(() => false);
  const code = lines.map(() => false);
  for (const token of markdown.parse(lines.join('\n'), {})) {
    if ((token.type !== 'fence' && token.type !== 'code_block') || !token.map) continue;
    for (let line = token.map[0]; line < token.map[1]; line++) {
      code[line] = true;
      if (token.type === 'fence') fence[line] = true;
    }
  }
  return { fence, code };
};

// The shared reader scanner against CommonMark (markdown-it, as the importer
// parses) on the generated fences in quotes and lists (#587). The examples run
// without their MDX wrappers: markdown-it reads `<CodeGroup>` as an HTML block,
// which MDX does not.
it('reads generated container fences as CommonMark does, except a fence indented with a tab after its containers', () => {
  const differing: number[] = [];
  let fenced = 0;
  for (const generated of fenceCases()) {
    if (!generated.fenced) continue;
    fenced++;
    const lines = [...generated.source.split('\n').slice(generated.exampleStart, generated.exampleEnd), '', 'sentinel'];
    const ours = fencedMarkdownLines(lines);
    const { fence, code } = commonMarkCode(lines);
    if (ours.every((isCode, line) => isCode === fence[line])) continue;
    differing.push(generated.index);
    // The one intentional difference, kept from main: a tab in the fence's own
    // indentation (`> \t```md`) is not read as a fence. That only ever flags
    // less, never prose: every line the scanner calls code is code to markdown-it.
    expect(generated.prefix, `case ${generated.index}`).toMatch(/^[^\t]+\t/);
    expect(
      ours.some((isCode, line) => isCode && !code[line]),
      `case ${generated.index}`,
    ).toBe(false);
  }
  expect(fenced).toBe(2457);
  expect(differing).toHaveLength(33);
});

it('reads indented code that looks like a fence as CommonMark does: never a fence (#590 council)', () => {
  const differing = indentedLookalikeCases().filter(({ source }) => {
    const lines = source.split('\n');
    return fencedMarkdownLines(lines).some((isCode, line) => isCode !== commonMarkCode(lines).fence[line]);
  });
  expect(differing.map(({ index, source }) => ({ index, source }))).toEqual([]);
});

it('reads fences opened on container continuation lines as CommonMark does (#590 CodeRabbit)', () => {
  const differing = continuationFenceCases().filter(({ source }) => {
    const lines = source.split('\n');
    return fencedMarkdownLines(lines).some((isCode, line) => isCode !== commonMarkCode(lines).fence[line]);
  });
  expect(differing.map(({ index, source }) => ({ index, source }))).toEqual([]);
  for (const [name, source, code] of CONTINUATION_FENCE_REPROS) {
    expect(commonMarkCode(source.split('\n')).fence.map(Number).join(''), name).toBe(code);
  }
});

it('reads ordered siblings, thematic breaks, lazy lines, setext underlines and HTML blocks as CommonMark does (#590 CodeRabbit)', ({ task }) => {
  type Tally = { cases: number; agree: number; codeMarkdownItCallsProse: number; exposedAgainstMain: number };
  const tallies = new Map<string, Tally>();
  const failures: Array<{ index: number; category: DifferentialCategory; source: string; ours: string; markdownIt: string }> = [];
  for (const { index, category, nested, source } of differentialCases()) {
    const lines = source.split('\n');
    const ours = fencedMarkdownLines(lines);
    const { fence, code } = commonMarkCode(lines);
    const main = mainFencedMarkdownLines(lines);
    for (const key of [category, `${category} (${nested ? 'nested' : 'top level'})`]) {
      const tally = tallies.get(key) ?? { cases: 0, agree: 0, codeMarkdownItCallsProse: 0, exposedAgainstMain: 0 };
      tally.cases++;
      if (ours.every((isCode, line) => isCode === fence[line])) tally.agree++;
      // Code where markdown-it reads prose would hide a heading.
      if (ours.some((isCode, line) => isCode && !code[line])) tally.codeMarkdownItCallsProse++;
      // Fenced code main protected and the scanner now exposes.
      if (main.some((isCode, line) => isCode && fence[line] && !ours[line])) tally.exposedAgainstMain++;
      tallies.set(key, tally);
    }
    if (!ours.every((isCode, line) => isCode === fence[line]))
      failures.push({ index, category, source, ours: ours.map(Number).join(''), markdownIt: fence.map(Number).join('') });
  }
  const table = Object.fromEntries(tallies);
  Object.assign(task.meta, { differential: table });
  console.info('differential against markdown-it:', table);
  expect(failures.slice(0, 8), `${failures.length} disagreements`).toEqual([]);
  for (const [name, source, code] of [...CODERABBIT_REPROS, ['an ordered line under a bullet item', ...ORDERED_LINE_UNDER_BULLET] as const]) {
    const lines = source.split('\n');
    expect(commonMarkCode(lines).fence.map(Number).join(''), name).toBe(code);
    expect(mainFencedMarkdownLines(lines).map(Number).join(''), `${name}: main`).toBe(code);
  }
});
