import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { markdownScanTemplate } from './markdown-scan';

type Scan = {
  inlineCodeRanges: (text: string) => Array<[number, number]>;
  expandSelfClosingComponents: (text: string) => string;
  stripMarkdownLinks: (text: string) => string;
  headingParts: (line: string) => { depth: 2 | 3; text: string } | null;
};

// The generated file itself, written to a gitignored cache folder and imported.
const root = resolve(import.meta.dirname, '../../.cache', `markdown-scan-${process.pid}`);
let scan: Scan;
beforeAll(async () => {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'markdown-scan.ts'), markdownScanTemplate());
  scan = (await import(/* @vite-ignore */ join(root, 'markdown-scan.ts'))) as Scan;
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const random = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
};
const texts = (seed: number, count: number, pieces: readonly string[], maxLength = 30): string[] => {
  const next = random(seed);
  return Array.from({ length: count }, () =>
    Array.from({ length: Math.floor(next() * maxLength) }, () => pieces[Math.floor(next() * pieces.length)]).join(''),
  );
};

/** The inline-code reading the template used before (src/lib/markdown.tsx), as ranges. */
const previousInlineCodeRanges = (text: string): Array<[number, number]> => {
  const ranges: Array<[number, number]> = [];
  let cursor = 0;
  while (cursor < text.length) {
    if (text[cursor] !== '`') {
      cursor += 1;
      continue;
    }
    let count = 1;
    while (text[cursor + count] === '`') count += 1;
    let closer = -1;
    for (let at = text.indexOf('`', cursor + count); at >= 0; ) {
      let run = 1;
      while (text[at + run] === '`') run += 1;
      if (run === count) {
        closer = at;
        break;
      }
      at = text.indexOf('`', at + run);
    }
    if (closer < 0) {
      cursor += count;
      continue;
    }
    ranges.push([cursor, closer + count]);
    cursor = closer + count;
  }
  return ranges;
};

describe('generated src/lib/markdown-scan.ts gives exactly what it replaces', () => {
  it('inlineCodeRanges: the previous inline-code reading', () => {
    for (const text of texts(3, 8000, ['`', '`', '``', '```', 'a', ' ', '\n'])) {
      expect(scan.inlineCodeRanges(text), JSON.stringify(text)).toEqual(previousInlineCodeRanges(text));
    }
  });

  it('expandSelfClosingComponents: /<(File|RelatedCard|Icon)\\b([^>]*)\\/>/gi', () => {
    const pieces = ['<File', '<file', '<Icon', '<RelatedCard', '<Files', '<Iconx', '/', '>', '/>', ' ', 'a', '"', '=', '\n', '<'];
    for (const text of texts(5, 8000, pieces)) {
      expect(scan.expandSelfClosingComponents(text), JSON.stringify(text)).toBe(
        text.replace(/<(File|RelatedCard|Icon)\b([^>]*)\/>/gi, '<$1$2></$1>'),
      );
    }
  });

  it('stripMarkdownLinks: /\\[([^\\]]+)\\]\\([^)]*\\)/g', () => {
    for (const text of texts(7, 8000, ['[', ']', '(', ')', '](', 'a', ' ', '\n', '!'])) {
      expect(scan.stripMarkdownLinks(text), JSON.stringify(text)).toBe(text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'));
    }
  });

  it('headingParts: /^(#{2,3})\\s+(.+?)\\s*#*\\s*$/', () => {
    const pieces = ['#', '#', ' ', ' ', '\t', '\r', '\u2028', '\u00a0', 'a', 'b'];
    const next = random(11);
    const lines = texts(13, 12_000, pieces, 14).map((line) => ['##', '###', '####', '#', ''][Math.floor(next() * 5)] + line);
    for (const line of lines) {
      const match = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
      const expected = match ? { depth: match[1]?.length === 2 ? 2 : 3, text: match[2] } : null;
      expect(scan.headingParts(line), JSON.stringify(line)).toEqual(expected);
    }
  });
});
