import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';

// Golden outputs for real authored content (a docs page, a blog post, the editor's round-trip
// fixture, an imported page) and a tour of every component. `.md` is what public Markdown and the
// llms files serve; `.export.md` is the Markdown the HTML and PDF exports hand to `marked`.
// A change here is a change readers and tools see: review the snapshot diff, don't just update it.
const fixtures = new URL('./__fixtures__/public-markdown/', import.meta.url);
const names = readdirSync(fixtures).filter((name) => name.endsWith('.mdx'));

/** Every fenced block and inline span of a source, with each line stripped of any quote or list
 *  prefix (a container re-prefixes code lines in the output). */
const codeOf = (source: string): string[] => {
  const unprefixed = (value: string) => value.replace(/^(?: {0,3}> ?)*(?: {0,3}[-*+] )?\s*/gm, '');
  const blocks = [...source.matchAll(/^(?:[ >-]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n(?:[ >-]*)\1[`~]*[ \t]*$/gm)].map((match) => match[0]);
  let prose = source;
  for (const block of blocks) prose = prose.replace(block, '');
  const spans = [...prose.matchAll(/(?<!`)(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g)].map((match) => match[0]).filter((span) => !span.includes('\n\n'));
  return [...blocks, ...spans].map(unprefixed);
};

describe('public Markdown code preservation (#338, #341)', () => {
  it('keeps every fenced block and inline span byte-identical in both outputs', () => {
    const source = readFileSync(new URL('code-preservation.mdx', fixtures), 'utf8');
    const code = codeOf(source);
    expect(code.length).toBeGreaterThanOrEqual(8);
    for (const output of [normalizePublicMarkdownContent(source), portablePublicMdxMarkdown(source)]) {
      const plain = output.replace(/^(?: {0,3}> ?)*(?: {0,3}[-*+] )?\s*/gm, '');
      for (const sample of code) expect(plain).toContain(sample);
    }
  });
});

describe('public Markdown golden outputs', () => {
  it.each(names)('%s', async (name) => {
    const source = readFileSync(new URL(name, fixtures), 'utf8');
    const base = name.replace(/\.mdx$/, '');
    await expect(`${normalizePublicMarkdownContent(source)}\n`).toMatchFileSnapshot(`./__fixtures__/public-markdown/__golden__/${base}.md`);
    await expect(portablePublicMdxMarkdown(source)).toMatchFileSnapshot(`./__fixtures__/public-markdown/__golden__/${base}.export.md`);
  });
});
