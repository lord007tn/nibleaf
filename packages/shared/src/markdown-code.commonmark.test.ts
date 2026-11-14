import { performance } from 'node:perf_hooks';
import MarkdownIt from 'markdown-it';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { expect, it, vi } from 'vitest';
import { fencedMarkdownLines, openingMarkdownFence } from './markdown-code';
import { readerSections } from './reader-headings';
import { extractHeadings } from './site';
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
  quoteCloserIndentationCases,
  TAB_BEFORE_QUOTE_IN_ITEM,
} from './testing/fence-cases';
import { mainFencedMarkdownLines } from './testing/markdown-code.main-reference';

// Some tests here work through large generated case sets or whole documentation
// corpora. On a loaded CI runner such tests have taken ~28x as long as on a laptop
// (5.5 s against 0.19 s), past Vitest's 5 s default, so the file gets an explicit
// timeout. Their cost stays linear; the *.growth.test.ts files pin that.
vi.setConfig({ testTimeout: 60_000 });

const markdown = new MarkdownIt({ html: true });

/** An independent CommonMark parser for markdown-it's nested-tab discrepancies.
 * A code node's source starts at its fence or at indented content; only the
 * former has an opening delimiter within three spaces. */
const micromarkFences = (source: string): boolean[] => {
  const flags = source.split('\n').map(() => false);
  const tree = fromMarkdown(source);
  const visit = (node: (typeof tree)['children'][number] | typeof tree): void => {
    if (node.type === 'code' && node.position) {
      const start = node.position.start.offset ?? 0;
      const newline = source.indexOf('\n', start);
      if (openingMarkdownFence(source.slice(start, newline < 0 ? source.length : newline)))
        for (let line = node.position.start.line - 1; line < node.position.end.line; line++) flags[line] = true;
    }
    if ('children' in node) for (const child of node.children) visit(child);
  };
  visit(tree);
  return flags;
};

it('measures tabs after quote markers in columns, including nested quotes, list items and indented code (#595)', () => {
  const examples = [
    ['> \t```md\n> # literal\n> ```\n\n## After', '11100'],
    ['>\t```md\n> # literal\n> ```\n\n## After', '11100'],
    ['> \t~~~\n> # literal\n> ~~~\n\n## After', '11100'],
    // Here the tab starts at column 4: four columns remain after the quote.
    ['> > \t```md\n> > # literal\n> > ```\n\n## After', '00100'],
    ['1. > \t```md\n   > # literal\n   > ```\n\n## After', '11100'],
    ['> \t\t```md\n> # prose\n\n## After', '0000'],
  ] as const;
  const failures: string[] = [];
  for (const [source, mask] of examples) {
    expect(commonMarkCode(source.split('\n')).fence.map(Number).join(''), source).toBe(mask);
    if (fencedMarkdownLines(source.split('\n')).map(Number).join('') !== mask) failures.push(source);
  }
  expect(failures).toEqual([]);
});

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

it('keeps literal lines after a quoted closer indented six columns (CodeRabbit r4570988540)', () => {
  const source = '> ~~~\n> \t\t~~~\n> literal\n> ~~~\nafter';
  expect(micromarkFences(source).map(Number).join('')).toBe('11110');
  expect(commonMarkCode(source.split('\n')).fence.map(Number).join('')).toBe('11110');
  expect(fencedMarkdownLines(source.split('\n')).map(Number).join('')).toBe('11110');
});

it.each(['~~~', '```'])('limits %s closers to three columns in quotes and both list/quote orders', (marker) => {
  const failures: Array<{ source: string; ours: string; expected: string }> = [];
  const markdownItDisagreements: number[] = [];
  const cases = quoteCloserIndentationCases().filter((example) => example.marker === marker);
  for (const [index, { source }] of cases.entries()) {
    const expected = micromarkFences(source).map(Number).join('');
    const ours = fencedMarkdownLines(source.split('\n')).map(Number).join('');
    const markdownIt = commonMarkCode(source.split('\n')).fence.map(Number).join('');
    if (ours !== expected) failures.push({ source, ours, expected });
    if (markdownIt !== expected) markdownItDisagreements.push(index);
  }
  console.info(`Closer indentation ${marker}: ${cases.length} cases, ${failures.length} disagreements`);
  expect(markdownItDisagreements).toEqual([]);
  expect(failures.slice(0, 8), `${failures.length} disagreements`).toEqual([]);
});

it('preserves deeply indented MDX closers while bounding ordinary closers', () => {
  const failures: Array<{ source: string; ours: string; expected: string }> = [];
  for (const marker of ['~~~', '```']) {
    const ordinary = [`> ${marker}`, `> \t\t${marker}`, '> literal', `> ${marker}`, 'after'];
    for (const [source, expected] of [
      [ordinary.join('\n'), '11110'],
      [[marker, `    ${marker}`, 'literal', marker, 'after'].join('\n'), '11110'],
      [[`- ${marker}`, `  \t\t${marker}`, '  literal', `  ${marker}`, 'after'].join('\n'), '11110'],
      [['<CodeGroup>', ...ordinary.slice(0, 4).map((line) => `    ${line}`), '</CodeGroup>', 'after'].join('\n'), '0110100'],
      [['<Note>', marker, `        ${marker}`, 'literal', '</Note>', 'after'].join('\n'), '011000'],
    ] as const) {
      const ours = fencedMarkdownLines(source.split('\n')).map(Number).join('');
      if (ours !== expected) failures.push({ source, ours, expected });
    }
  }
  expect(failures).toEqual([]);
});

// The shared reader scanner against CommonMark (markdown-it, as the importer
// parses) on the generated fences in quotes and lists (#587). The examples run
// without their MDX wrappers: markdown-it reads `<CodeGroup>` as an HTML block,
// which MDX does not.
it('reads all generated container fences as CommonMark does, including tabs after quote markers', () => {
  const differing: number[] = [];
  let fenced = 0;
  for (const generated of fenceCases()) {
    if (!generated.fenced) continue;
    fenced++;
    const lines = [...generated.source.split('\n').slice(generated.exampleStart, generated.exampleEnd), '', 'sentinel'];
    const ours = fencedMarkdownLines(lines);
    const { fence } = commonMarkCode(lines);
    if (ours.every((isCode, line) => isCode === fence[line])) continue;
    differing.push(generated.index);
  }
  expect(fenced).toBe(2457);
  expect(differing).toEqual([]);
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
  const start = performance.now();
  type Tally = { cases: number; agree: number; codeMarkdownItCallsProse: number; exposedAgainstMain: number };
  const tallies = new Map<string, Tally>();
  const failures: Array<{ index: number; category: DifferentialCategory; source: string; ours: string; expected: string }> = [];
  const markdownItDisagreements: number[] = [];
  const cases = differentialCases();
  for (const { index, category, nested, source } of cases) {
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
    // Check every closer shape with micromark. Keep the existing independent
    // opener pins where markdown-it loses cumulative tab offsets in nested quotes.
    const expected =
      category === 'tab-after-quote closer indentation' ||
      (category === 'tab after a quote marker before a fence' && !ours.every((isCode, line) => isCode === fence[line]))
        ? micromarkFences(source)
        : fence;
    if (!expected.every((isCode, line) => isCode === fence[line])) markdownItDisagreements.push(index);
    if (!ours.every((isCode, line) => isCode === expected[line]))
      failures.push({ index, category, source, ours: ours.map(Number).join(''), expected: expected.map(Number).join('') });
  }
  const table = Object.fromEntries(tallies);
  Object.assign(task.meta, { differential: table });
  console.info('differential against markdown-it:', table);
  console.info(
    `markdown-it differential: ${cases.length} cases in ${(performance.now() - start).toFixed(1)} ms; ${markdownItDisagreements.length} discrepancies pinned with micromark`,
  );
  expect(markdownItDisagreements).toEqual([3092, 3111, 3119, 3194, 3252, 3373, 3438, 3504, 3514, 3552, 3700, 4001]);
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
