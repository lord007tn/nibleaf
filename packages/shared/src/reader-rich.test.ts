import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fencedMarkdownLines } from './markdown-code';
import { containsHtmlTag, containsMath, needsRichMarkdown, replaceHtmlTags } from './reader-rich';

/** The detection as it was written with regular expressions (before the linear
 * scan). Its answers are the reference: the scan must give the same ones. */
const INLINE_CODE = /(?<![\\`])(`+)[^`\n]+?\1(?!`)/g;
const CONTAINER_FENCE = /^[ \t]*(?:>|[-*+][ \t]|\d{1,9}[.)][ \t])[ \t>]*(?:`{3,}|~{3,})/m;
const referenceWithoutCode = (content: string): string => {
  if (!content.includes('`') && !content.includes('~~~')) return content;
  if (CONTAINER_FENCE.test(content)) return content;
  const lines = content.split('\n');
  const fenced = fencedMarkdownLines(lines);
  return lines.map((line, index) => (fenced[index] ? '' : line.replace(INLINE_CODE, ''))).join('\n');
};
const TAG = /<\/?[A-Za-z][^>]*>/;
const MATH = /(^|[^\\])\$\$?[\s\S]*?\$\$?/m;
const reference = (content: string): boolean => {
  const prose = referenceWithoutCode(content);
  return TAG.test(prose) || MATH.test(prose);
};
/** Search's snippet text replaced tags this way. */
const referenceReplaceTags = (text: string) => text.replace(/<\/?[A-Za-z][^>]*>/g, ' ');

/** A small seeded generator, so a failure names a string that reproduces. */
const random = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
};
const ALPHABET = ['<', '>', '/', 'a', 'Z', '$', '\\', '`', '``', '```', '\n', ' ', 'x', '~~~', '- ', '> ', '1. ', '\t', '#', 'é'];

const docs = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return docs(path);
    return entry.name.endsWith('.mdx') ? [path] : [];
  });

describe('rich renderer detection', () => {
  it.each([
    ['<Note>x</Note>', true],
    ['a </b> c', true],
    ['< a>', false],
    ['<1>', false],
    ['<a', false],
    ['a > b < c', false],
    ['Inline $x^2$ math', true],
    ['$$\\frac{a}{b}$$', true],
    ['The plan costs \\$5 per month.', false],
    ['$5 and \\$6', true],
    ['\\$5 only', false],
    ['`<div>` and `$HOME`', false],
    ['``a`b`` and `<x>`', false],
    ['\\`<b>\\`', true],
    ['```\n<div>\n```', false],
    ['> ```\n<div>', true],
  ])('reads %j as rich: %s', (content, rich) => {
    expect(needsRichMarkdown(content)).toBe(rich);
    expect(reference(content)).toBe(rich);
  });

  it('agrees with the regular-expression detection on every documentation page', () => {
    // Tests run from packages/shared.
    const pages = docs(join(process.cwd(), '..', '..', 'docs'));
    expect(pages.length).toBeGreaterThan(40);
    for (const path of pages) {
      const content = readFileSync(path, 'utf8');
      expect(needsRichMarkdown(content), path).toBe(reference(content));
    }
  });

  it('agrees with the regular-expression detection on random Markdown-ish text', () => {
    const next = random(534);
    for (let run = 0; run < 20_000; run += 1) {
      const parts = Array.from({ length: 1 + Math.floor(next() * 24) }, () => ALPHABET[Math.floor(next() * ALPHABET.length)]);
      const content = parts.join('');
      expect(needsRichMarkdown(content), JSON.stringify(content)).toBe(reference(content));
      expect(containsHtmlTag(content), JSON.stringify(content)).toBe(TAG.test(content));
      expect(containsMath(content), JSON.stringify(content)).toBe(MATH.test(content));
      expect(replaceHtmlTags(content, ' '), JSON.stringify(content)).toBe(referenceReplaceTags(content));
    }
  });
});

describe('tag replacement for search text', () => {
  it.each([
    ['a <b>bold</b> c', 'a  bold  c'],
    ['<Note type="tip">x</Note>', ' x '],
    ['<a title="<x>">y', ' ">y'],
    ['< a> <1> <a', '< a> <1> <a'],
    ['<a> <b', '  <b'],
  ])('replaces the tags in %j', (text, replaced) => {
    expect(replaceHtmlTags(text, ' ')).toBe(replaced);
    expect(referenceReplaceTags(text)).toBe(replaced);
  });

  it('agrees with the regular-expression replacement on every documentation page', () => {
    for (const path of docs(join(process.cwd(), '..', '..', 'docs'))) {
      const content = readFileSync(path, 'utf8');
      expect(replaceHtmlTags(content, ' '), path).toBe(referenceReplaceTags(content));
      expect(containsMath(content), path).toBe(MATH.test(content));
    }
  });
});
