import { fencedMarkdownLines } from '@nibleaf/shared/markdown-code';
import { describe, expect, it } from 'vitest';
import { convertGitBookMarkdown } from './gitbook-markdown';
import { importCodeLines } from './import-markdown-code';
import { rewriteMintlifyInternalLinks } from './mintlify-links';
import { normalizeMintlifyMdx } from './mintlify-mdx';

const cases = [
  [
    'false closer in nested ordered and quoted lists (case 39)',
    '<CodeGroup>\n1. >- ````md\n   >   [Literal](/literal)\n   >   - ````\n   >   [Still literal](/literal)\n   >   ````\n</CodeGroup>\n\n[Sentinel 39](/sentinel)',
  ],
  [
    'false closer in a multiline component with nested lists (case 147)',
    '<CodeGroup\n  title="Example > sample"\n>\n1. - > `````md\n     > [Literal](/literal)\n     > > `````\n     > [Still literal](/literal)\n     > `````\n</CodeGroup>\n\n[Sentinel 147](/sentinel)',
  ],
  [
    'partial tab after a quote in a list (case 177)',
    '<CodeGroup>\n- > \t````md\n  > \t[Literal](/literal)\n  > \t> ````\n  > \t[Still literal](/literal)\n  > \t````\n</CodeGroup>\n\n[Sentinel 177](/sentinel)',
  ],
  [
    'ordinary fence ends on its opening line in nested quotes (case 654)',
    '>>\t- ~~~~~md\n> >\t  [Literal](/literal)\n> >\t  > ~~~~~\n> >\t  [Still literal](/literal)\n> >\t  ~~~~~\n\n[Sentinel 654](/sentinel)',
  ],
  [
    'false closer after nested quote tabs in a list (case 688)',
    '<CodeGroup\n  title="Example > sample"\n>\n- >\t>\t```md\n  >\t>\t[Literal](/literal)\n  >\t>\t> ```\n  >\t>\t[Still literal](/literal)\n  >\t>\t`````\n</CodeGroup>\n\n[Sentinel 688](/sentinel)',
  ],
  [
    'false closer before a longer tabbed closing fence (case 847)',
    '<CodeGroup\n  title="Example > sample"\n>\n- >\t```md\n  >\t[Literal](/literal)\n  >\t> ```\n  >\t[Still literal](/literal)\n  >\t````\n</CodeGroup>\n\n[Sentinel 847](/sentinel)',
  ],
  [
    'ordinary fence ends on its opening line before a tab (case 2158)',
    '>1. \t`````md\n>    \t[Literal](/literal)\n>    \t- `````\n>    \t[Still literal](/literal)\n>    \t`````\n\n[Sentinel 2158](/sentinel)',
  ],
  [
    'ordinary fence ends on its opening line after a self-closing component (case 2924)',
    '<Example\n  title="Literal />"\n/>\n>>\t1. ```md\n> >\t   [Literal](/literal)\n> >\t   ~~~\n> >\t   [Still literal](/literal)\n> >\t   ```\n\n[Sentinel 2924](/sentinel)',
  ],
] as const;

describe.each([
  ['GitBook', (source: string) => convertGitBookMarkdown(source, { resolveFile: () => undefined }).content],
  ['Mintlify', normalizeMintlifyMdx],
] as const)('fixed-seed scanner regressions: %s', (_name, convert) => {
  it.each(cases)('%s', (_label, source) => {
    expect(importCodeLines(source).at(-1)).toBe(false);
    const content = rewriteMintlifyInternalLinks(convert(source), 'intro', new Map([['sentinel', '/rewritten']]));
    expect(content).toContain('/rewritten)');
  });
});

describe('main oracle overruns retained as reported compatibility limits', () => {
  it.each([
    ['new quote marker', '~~~~md\n[Literal](/literal)\n> ~~~~\n[Still literal](/literal)\n~~~~~'],
    ['new list marker', '~~~~md\n[Literal](/literal)\n- ~~~~\n[Still literal](/literal)\n~~~~~'],
    ['nested containers', '- > ````md\n  > [Literal](/literal)\n  > ````'],
    ['nested containers with a wrong marker', '- > >`````md\n  > > [Literal](/literal)\n  > > ~~~~~\n  > > [Still literal](/literal)\n  > > `````'],
    [
      'nested containers with a short marker',
      '<CodeGroup>\n1. > - ~~~md\n   >   [Literal](/literal)\n   >   ~~\n   >   [Still literal](/literal)\n   >   ~~~~\n</CodeGroup>',
    ],
  ])('%s reopens main at a real closer but must not hide following prose', (_name, example) => {
    const source = `${example}\n\n[Sentinel](/sentinel)`;
    expect(fencedMarkdownLines(source.split('\n')).at(-1)).toBe(true);
    expect(importCodeLines(source).at(-1)).toBe(false);
  });
});
