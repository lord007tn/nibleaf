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

/** The kinds of input the comparison must reach, so a smaller run still covers each. */
const ALL_CASES: string[] = [
  'tag',
  'math',
  'plain',
  'escaped dollar',
  'unclosed tag start',
  'inline code removed',
  'fenced code',
  'container fence',
  'code hides tag or math',
  'tags replaced',
];
const caseClasses = (content: string): string[] => {
  const prose = referenceWithoutCode(content);
  const classes: string[] = [];
  if (TAG.test(content)) classes.push('tag');
  if (MATH.test(content)) classes.push('math');
  if (!TAG.test(content) && !MATH.test(content)) classes.push('plain');
  if (content.includes('\\$')) classes.push('escaped dollar');
  if (/<\/?[A-Za-z]/.test(content) && !TAG.test(content)) classes.push('unclosed tag start');
  if (CONTAINER_FENCE.test(content)) classes.push('container fence');
  else if (fencedMarkdownLines(content.split('\n')).some(Boolean)) classes.push('fenced code');
  else if (prose !== content) classes.push('inline code removed');
  if ((TAG.test(content) || MATH.test(content)) && !reference(content)) classes.push('code hides tag or math');
  if (referenceReplaceTags(content) !== content) classes.push('tags replaced');
  return classes;
};

/** Compares every check with its reference on `count` seeded random strings; one
 * collected list of mismatches rather than an assertion per string keeps it quick. */
const compareOn = (count: number) => {
  const next = random(534);
  const mismatches: string[] = [];
  const covered = new Set<string>();
  for (let run = 0; run < count; run += 1) {
    const content = Array.from({ length: 1 + Math.floor(next() * 24) }, () => ALPHABET[Math.floor(next() * ALPHABET.length)]).join('');
    for (const name of caseClasses(content)) covered.add(name);
    if (
      needsRichMarkdown(content) !== reference(content) ||
      containsHtmlTag(content) !== TAG.test(content) ||
      containsMath(content) !== MATH.test(content) ||
      replaceHtmlTags(content, ' ') !== referenceReplaceTags(content)
    )
      mismatches.push(JSON.stringify(content));
  }
  return { mismatches, covered: [...covered] };
};

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
    const { mismatches, covered } = compareOn(2000);
    expect(mismatches).toEqual([]);
    // Fewer strings than the deep run, still every kind of case.
    expect(covered).toEqual(expect.arrayContaining(ALL_CASES));
  });

  // The same comparison on 20,000 strings, for a change to the detection:
  // NIBLEAF_PROPERTY_DEEP=1 pnpm --filter @nibleaf/shared exec vitest run reader-rich.test
  it.runIf(process.env.NIBLEAF_PROPERTY_DEEP === '1')(
    'agrees on 20,000 random strings (opt-in deep run)',
    () => {
      const { mismatches, covered } = compareOn(20_000);
      expect(mismatches).toEqual([]);
      expect(covered).toEqual(expect.arrayContaining(ALL_CASES));
    },
    120_000,
  );
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
