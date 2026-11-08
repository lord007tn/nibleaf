import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';

// Golden outputs for real authored content (a docs page, a blog post, the editor's round-trip
// fixture, an imported page) and a tour of every component. `.md` is what public Markdown and the
// llms files serve; `.export.md` is the Markdown the HTML and PDF exports hand to `marked`.
// A change here is a change readers and tools see: review the snapshot diff, don't just update it.
const fixtures = new URL('./__fixtures__/public-markdown/', import.meta.url);
const names = readdirSync(fixtures).filter((name) => name.endsWith('.mdx'));

describe('public Markdown golden outputs', () => {
  it.each(names)('%s', async (name) => {
    const source = readFileSync(new URL(name, fixtures), 'utf8');
    const base = name.replace(/\.mdx$/, '');
    await expect(`${normalizePublicMarkdownContent(source)}\n`).toMatchFileSnapshot(`./__fixtures__/public-markdown/__golden__/${base}.md`);
    await expect(portablePublicMdxMarkdown(source)).toMatchFileSnapshot(`./__fixtures__/public-markdown/__golden__/${base}.export.md`);
  });
});
