import { fencedMarkdownLines } from '@nibleaf/shared/markdown-code';
import { CONTINUATION_FENCE_REPROS, continuationFenceCases, fenceCases, indentedLookalikeCases } from '@nibleaf/shared/testing/fence-cases';
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
