import { fencedMarkdownLines, markdownLineKinds } from '@nibleaf/shared/markdown-code';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { convertGitBookMarkdown } from './gitbook-markdown';
import { importCodeLines } from './import-markdown-code';
import { rewriteMintlifyInternalLinks } from './mintlify-links';
import { normalizeMintlifyMdx } from './mintlify-mdx';

it.each([
  ['list', '- Step one', '  ', '- Step two'],
  ['nested list', '- Outer\n\n  - Step one', '    ', '  - Step two'],
  ['quote', '> Step one', '> ', '> Step two'],
  ['quote in list', '- Outer\n\n  > Step one', '  > ', '- Step two'],
  ['numbered list', '1. Step one', '   ', '2. Step two'],
])('keeps GitBook embeds and following prose in their %s (#585)', (_name, opening, prefix, ending) => {
  const source = `${opening}\n${prefix}\n${prefix}{% embed url="https://youtu.be/abcdefghijk" %}\n${prefix}\n${prefix}Then continue.\n${ending}`;
  const content = convertGitBookMarkdown(source, { resolveFile: () => undefined }).content;
  expect(content).toContain(`\n${prefix}<iframe `);
  expect(content).toContain(`\n${prefix}Then continue.`);
  // No editor load/save helper exists in importer tests. Check the shared
  // reader's block classification and the Markdown parser's container depths.
  expect(fencedMarkdownLines(content.split('\n')).some(Boolean)).toBe(false);
  expect(markdownLineKinds(content.split('\n'))[content.split('\n').findIndex((line) => line.includes('Then continue.'))]).toBe('prose');
  const tokens = new MarkdownIt({ html: true }).parse(content, {});
  const frame = tokens.find((token) => token.type === 'html_block' && token.content.includes('<iframe'));
  const following = tokens.find((token) => token.type === 'inline' && token.content.startsWith('Then continue.'));
  expect(frame).toBeDefined();
  expect(following).toBeDefined();
  expect(frame?.level).toBeGreaterThan(0);
  expect(following?.level).toBe((frame?.level ?? 0) + 1);
});

describe.each([
  [
    'GitBook',
    (source: string, issues: string[]) => {
      const result = convertGitBookMarkdown(source, { resolveFile: () => undefined });
      issues.push(...result.issues.map(({ reference }) => reference));
      return result.content;
    },
  ],
  ['Mintlify', (source: string, issues: string[]) => normalizeMintlifyMdx(source, (url) => issues.push(url))],
] as const)('%s container/media regressions', (_name, convert) => {
  it('also preserves the unindented #588 issue example (already passing on main)', () => {
    const source = '<CodeGroup>\n> ```md\n> [Literal](/literal)\n</CodeGroup>\n\n[After](/next)';
    const content = rewriteMintlifyInternalLinks(convert(source, []), 'intro', new Map([['next', '/rewritten']]));
    expect(content).toContain('[After](/rewritten)');
    expect(normalizeMintlifyMdx(content)).not.toContain('</CodeGroup>');
  });
  it.each([
    ['http', '<video src="http://cdn.test/a.mp4">', 'http://cdn.test/a.mp4'],
    ['https', '<video src="https://cdn.test/a.mp4">', 'https://cdn.test/a.mp4'],
    ['no source', '<video>', ''],
    ['following content', '<video src="https://cdn.test/a.mp4">\n\nKeep this paragraph.\n\n[After](/next)', 'https://cdn.test/a.mp4'],
  ])('makes an unclosed video inert: %s (#584)', (_case, source, url) => {
    const issues: string[] = [];
    const content = convert(source, issues);
    expect(content).not.toContain('<video');
    if (url) expect(content).toContain(`<a href="${url}">`);
    else expect(content).toContain('&lt;video&gt;');
    if (source.includes('Keep this')) expect(content).toContain('Keep this paragraph.\n\n[After](/next)');
    expect(issues).toHaveLength(1);
  });

  it.each([
    ['quote', '    > ```md\n    > [Literal](/literal)'],
    ['list', '    - ```md\n      [Literal](/literal)'],
    ['list with blank', '    - ```md\n      [Literal](/literal)\n\n      [Still literal](/literal)'],
  ])('ends an unclosed %s fence before the component closer (#588)', (_case, example) => {
    const source = `<CodeGroup>\n${example}\n</CodeGroup>\n\n[After](/next)`;
    const code = importCodeLines(source);
    expect(code).toEqual(fencedMarkdownLines(source.split('\n')));
    expect(code[source.split('\n').indexOf('</CodeGroup>')]).toBe(false);
    const content = rewriteMintlifyInternalLinks(convert(source, []), 'intro', new Map([['next', '/rewritten']]));
    expect(content).toContain('[Literal](/literal)');
    if (example.includes('Still literal')) expect(content).toContain('[Still literal](/literal)');
    expect(content).toContain('[After](/rewritten)');
    expect(normalizeMintlifyMdx(content)).not.toContain('</CodeGroup>');
  });
});
