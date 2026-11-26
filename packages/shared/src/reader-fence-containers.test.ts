import { expect, it } from 'vitest';
import { fencedMarkdownLines } from './markdown-code';
import { readerSections } from './reader-headings';
import { normalizeMdxBlocks } from './reader-markdown';
import { extractHeadings } from './site';
import {
  AFTER_CONTINUATION,
  AFTER_FENCE,
  CODERABBIT_REPROS,
  CONTINUATION_FENCE_REPROS,
  FENCE_CONTAINER_REPROS,
  INDENTED_FENCE_AFTER_QUOTE,
  LAZY_INLINE_HTML_REPROS,
  LAZY_TEXT_AFTER_INLINE_HTML,
} from './testing/fence-cases';

const continuationCases = [
  ...CONTINUATION_FENCE_REPROS,
  ...CODERABBIT_REPROS,
  ...LAZY_INLINE_HTML_REPROS,
  ['a list paragraph with lazy text following inline HTML', LAZY_TEXT_AFTER_INLINE_HTML.source, LAZY_TEXT_AFTER_INLINE_HTML.code],
] as const;

const cases = [
  ...FENCE_CONTAINER_REPROS.map(([name, example]) => [name, `${example}${AFTER_FENCE}`, `${'1'.repeat(example.split('\n').length)}0000`] as const),
  ...continuationCases.map(([name, example, code]) => [name, `${example}${AFTER_CONTINUATION}`, `${code}00`] as const),
  ['indented code resembling a new fence after a quote', INDENTED_FENCE_AFTER_QUOTE, '1000000'],
] as const;

it.each(cases)('keeps the heading, section and embed following %s', (_name, source, code) => {
  expect(fencedMarkdownLines(source.split('\n')).map(Number).join('')).toBe(code);
  expect(extractHeadings(source).map(({ text }) => text)).toEqual(['After']);
  expect(readerSections(source).map(({ text }) => text)).toEqual(['After']);
  expect(normalizeMdxBlocks(source)).toContain('<mdxembed provider="youtube" videoid="M7lc1UVf-VE"');
});

const examples = [
  '> ```md\n> example\n>```',
  '> ```md\n> example\n> ```',
  '> > ```md\n> > example\n>>```',
  '> ```md\n>\texample\n>```',
  '>\t```md\n>\texample\n>\t```',
  '- ```md\n  example\n  ```',
  '- ```md\n\texample\n  ```',
] as const;
const article = (example: string) =>
  `${example}\n\n# After\n\n<iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk" title="Tour"></iframe>`;

it('reads headings and embeds after closed fences with optional quote spacing, nesting, tabs and lists', () => {
  for (const example of examples) {
    const source = article(example);
    expect(fencedMarkdownLines(source.split('\n'))[4], example).toBe(false);
    expect(
      extractHeadings(source).map(({ text }) => text),
      example,
    ).toEqual(['After']);
    expect(
      readerSections(source).map(({ text }) => text),
      example,
    ).toEqual(['After']);
    expect(normalizeMdxBlocks(source), example).toContain('<mdxembed');
  }
});
