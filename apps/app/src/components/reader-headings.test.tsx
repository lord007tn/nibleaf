// @vitest-environment jsdom

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readerHeadings } from '@nibleaf/shared/reader-headings';
import { readerRenderMode } from '@nibleaf/shared/reader-render-mode';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownRenderer } from './markdown';
import { mathPlugins } from './markdown-math';
import RichMarkdown from './markdown-rich';

/*
 * Differential test: the headings the reader's renderer puts in the page (level,
 * text, DOM id) must be exactly the ones the shared parser reads
 * (`@nibleaf/shared/reader-headings`), which the search indexer records and the
 * chat's citation check verifies against. Fixtures: every documentation page in
 * this repository (English and Arabic), and the cases where a hand-rolled reader
 * of Markdown headings used to disagree with the renderer.
 */

const site = { projectId: 'project', lang: 'en', defaultLanguage: 'en' };
/** The headings the renderer outputs, read from its HTML as a browser would. */
const rendered = (content: string) => {
  const { rich, math } = readerRenderMode(content);
  // The rich renderer gets KaTeX exactly when the reader loads it for this page.
  const html = renderToStaticMarkup(
    rich ? createElement(RichMarkdown, { content, site, math: math ? mathPlugins : undefined }) : createElement(MarkdownRenderer, { content, site }),
  );
  const document = new DOMParser().parseFromString(html, 'text/html');
  return [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((heading) => ({
    depth: Number(heading.tagName[1]),
    text: (heading.textContent ?? '').trim(),
    id: heading.id,
  }));
};
const shared = (content: string) => readerHeadings(content).map(({ depth, text, id }) => ({ depth, text, id }));

// Tests run from apps/app (vitest root).
const docsRoot = join(process.cwd(), '..', '..', 'docs');
const pages = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return pages(path);
    return entry.name.endsWith('.mdx') ? [path] : [];
  });
/** A page body as the reader gets it: frontmatter is metadata, not content. */
const body = (path: string) => readFileSync(path, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

const lines = (...parts: string[]) => parts.join('\n');
const CASES: Record<string, string> = {
  'an HTML entity': lines('## API &amp; keys', '', 'Text.'),
  'inline HTML': lines('## Use <kbd>Ctrl</kbd> and <code>npm</code>', '', 'Text.'),
  'a component around a heading': lines('<Note>', '## Inside a note', '', 'Text.', '</Note>', '', '## Inside a note'),
  'h5 and h6 in the dedupe order': lines('## Setup', '', '##### Install', '', '## Install', '', '###### Install', '', '#### Install'),
  'a heading in a nested fence': lines('## Example', '', '````md', '```sh', 'echo hi', '```', '## Install', '````', '', '## Install'),
  'math in a heading': lines('## Area of $a^2$', '', 'Text.', '', '## Area of $a^2$'),
  'an id the author set': lines('<h2 id="custom">Custom</h2>', '', '## Custom'),
  'setext headings': lines('Title', '=====', '', 'Text.', '', 'Sub part', '--------', '', 'More.'),
  'repeated Arabic headings with diacritics': lines('## التثبيت', '', 'نص.', '', '## تحقّق مما يراه القرّاء', '', '## التثبيت'),
  'inline Markdown': lines('### Install with `npm` and **pnpm** [now](https://example.com)', '', 'Text.'),
};

describe('the reader’s headings, rendered and read', () => {
  it.each(Object.entries(CASES))('agree for %s', (_name, content) => {
    expect(shared(content)).toEqual(rendered(content));
    expect(rendered(content).length).toBeGreaterThan(0);
  });

  const fixtures = pages(docsRoot);
  it('covers this repository’s documentation in both languages', () => {
    expect(fixtures.length).toBeGreaterThan(40);
    expect(fixtures.some((path) => relative(docsRoot, path).startsWith('ar'))).toBe(true);
  });
  it.each(fixtures.map((path) => [relative(docsRoot, path), path]))('agree for docs/%s', (_name, path) => {
    const content = body(path);
    expect(shared(content)).toEqual(rendered(content));
  });
});
