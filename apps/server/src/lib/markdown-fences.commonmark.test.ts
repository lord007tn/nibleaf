import { fencedMarkdownLines } from '@nibleaf/shared/markdown-code';
import { readerSections } from '@nibleaf/shared/reader-headings';
import { extractHeadings } from '@nibleaf/shared/site';
import {
  CODERABBIT_REPROS,
  CONTINUATION_FENCE_REPROS,
  continuationFenceCases,
  type DifferentialCategory,
  differentialCases,
  fenceCases,
  HTML_BLOCK_HEADING_REPROS,
  HTML_BLOCK_REPEATED_HEADING,
  HTML_BLOCK_WITHOUT_BLANK,
  HTML_COMMENT_WITH_BANG_CLOSER,
  indentedLookalikeCases,
  LAZY_INLINE_HTML_REPROS,
  ORDERED_LINE_UNDER_BULLET,
  QUOTED_DOCTYPE_BLOCK,
  TAB_BEFORE_QUOTE_IN_ITEM,
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
  // An HTML comment block ends at `-->`, not `--!>`: markdown-it keeps the fence-like line in it.
  const commentLines = HTML_COMMENT_WITH_BANG_CLOSER.split('\n');
  expect(commonMarkCode(commentLines).fence.map(Number).join('')).toBe('000000');
  expect(fencedMarkdownLines(commentLines).map(Number).join('')).toBe('000000');
  // #592: a tab before `>` inside a list item opens a quoted fence there.
  const tabLines = TAB_BEFORE_QUOTE_IN_ITEM[0].split('\n');
  expect(commonMarkCode(tabLines).fence.map(Number).join('')).toBe(TAB_BEFORE_QUOTE_IN_ITEM[1]);
  expect(fencedMarkdownLines(tabLines).map(Number).join('')).toBe(TAB_BEFORE_QUOTE_IN_ITEM[1]);
  for (const [name, source, code] of [
    ...CODERABBIT_REPROS,
    ...LAZY_INLINE_HTML_REPROS,
    ['an ordered line under a bullet item', ...ORDERED_LINE_UNDER_BULLET] as const,
  ]) {
    const lines = source.split('\n');
    expect(commonMarkCode(lines).fence.map(Number).join(''), name).toBe(code);
    expect(mainFencedMarkdownLines(lines).map(Number).join(''), `${name}: main`).toBe(code);
  }
});

/** markdown-it's headings: text and source line of each `heading_open`. */
const commonMarkHeadings = (source: string) => {
  const tokens = markdown.parse(source, {});
  return tokens.flatMap((token, index) =>
    token.type === 'heading_open' && token.map ? [{ text: tokens[index + 1]?.content ?? '', line: token.map[0] }] : [],
  );
};

it('lists the headings markdown-it renders, none from inside an HTML block (#593)', () => {
  for (const [name, source] of [
    ...HTML_BLOCK_HEADING_REPROS,
    ['a repeated heading inside an HTML block', HTML_BLOCK_REPEATED_HEADING] as const,
    ['a heading with no blank line after an HTML block', HTML_BLOCK_WITHOUT_BLANK] as const,
    ['a `<!DOCTYPE` block in a quote', QUOTED_DOCTYPE_BLOCK.source] as const,
  ]) {
    const lines = source.split('\n');
    expect(fencedMarkdownLines(lines), `${name}: fences`).toEqual(commonMarkCode(lines).fence);
    const expected = commonMarkHeadings(source);
    expect(
      extractHeadings(source).map(({ text }) => text),
      name,
    ).toEqual(expected.map(({ text }) => text));
    expect(
      readerSections(source).map(({ text, line }) => ({ text, line })),
      name,
    ).toEqual(expected);
  }
});

it('never lists a heading that markdown-it puts inside an HTML block, across the differential cases (#593)', ({ task }) => {
  const tallies = new Map<string, { cases: number; agree: number; listedFromHtml: number }>();
  const failures: Array<{ index: number; source: string; ours: string[]; markdownIt: string[] }> = [];
  for (const { index, category, source } of differentialCases()) {
    const ours = extractHeadings(source).map(({ text }) => text);
    const theirs = commonMarkHeadings(source).map(({ text }) => text);
    // A heading the outline lists that markdown-it does not render: one inside an HTML block.
    const unmatched = [...theirs];
    const listedFromHtml = ours.filter((text) => {
      const at = unmatched.indexOf(text);
      if (at < 0) return true;
      unmatched.splice(at, 1);
      return false;
    });
    for (const key of [category, 'all categories']) {
      const tally = tallies.get(key) ?? { cases: 0, agree: 0, listedFromHtml: 0 };
      tally.cases++;
      if (ours.join('\n') === theirs.join('\n')) tally.agree++;
      if (listedFromHtml.length > 0) tally.listedFromHtml++;
      tallies.set(key, tally);
    }
    if (listedFromHtml.length > 0) failures.push({ index, source, ours, markdownIt: theirs });
  }
  const table = Object.fromEntries(tallies);
  Object.assign(task.meta, { headingsAgainstMarkdownIt: table });
  console.info('extractHeadings against markdown-it:', table);
  expect(failures.slice(0, 8), `${failures.length} cases list a heading from inside an HTML block`).toEqual([]);
});
