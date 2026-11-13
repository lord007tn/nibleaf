import { describe, expect, it } from 'vitest';
import { convertGitBookMarkdown } from './gitbook-markdown';
import { importCodeLines } from './import-markdown-code';
import { mintlifyInternalLinkTargets, rewriteMintlifyInternalLinks } from './mintlify-links';
import { normalizeMintlifyMdx } from './mintlify-mdx';

describe.each([
  ['GitBook', (source: string) => convertGitBookMarkdown(source, { resolveFile: () => undefined }).content],
  ['Mintlify', normalizeMintlifyMdx],
] as const)('tab fence fidelity: %s', (_name, convert) => {
  it.each([
    ['quote tab', '>\t', '>\t', 4],
    ['longer closer', '>\t', '>\t', 5],
    ['quote tab inside list', '- >\t', '  >\t', 4],
    ['quote tab inside ordered list', '1. >\t', '   >\t', 5],
  ])('protects literal provider links and source bytes in %s', (_form, opener, body, length) => {
    const literal = `${opener}\`\`\`md\n${body}[Tour](https://youtu.be/abcdefghijk)\n${body}${'`'.repeat(length)}`;
    const source = `<CodeGroup>\n${literal}\n</CodeGroup>\n\n[After](/next)`;
    const lines = importCodeLines(source);
    expect(lines.slice(1, 4)).toEqual([true, true, true]);
    expect(lines.at(-1)).toBe(false);
    const content = rewriteMintlifyInternalLinks(convert(source), 'intro', new Map([['next', '/guide/next']]));
    expect(content).toContain(literal);
    expect(content).not.toContain('<iframe');
    expect(content).toContain('[After](/guide/next)');
  });

  it('discovers the existing app destination before an unrelated source file', () => {
    const routes = new Map([
      ['intro', '/intro'],
      ['api/next', '/next'],
    ]);
    const content = convert('[Next](https://nibleaf.com/pages/next)');
    expect(mintlifyInternalLinkTargets(content, 'intro', undefined, undefined, 'en', ['en'], routes)).toEqual(['api/next']);
    expect(rewriteMintlifyInternalLinks(content, 'intro', routes)).toBe('[Next](/next)');
  });
});
