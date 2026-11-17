import { describe, expect, it } from 'vitest';
import { stripMarkdown } from './index';

/** `stripMarkdown` as it was: the regex chain the linear version must match. */
const regexStripMarkdown = (src: string): string =>
  src
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
    .replace(/\[!\w+\]/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s*([-=*_]\s*){3,}$/gm, ' ')
    .replace(/[*~]{1,3}/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const random = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
};

const PIECES = [
  '\n',
  '\n\n',
  ' ',
  '  ',
  '\t',
  'x',
  'word',
  '1.',
  '12.',
  '-',
  '*',
  '+',
  '=',
  '_',
  '#',
  '## ',
  '> ',
  '|',
  '~~',
  '**',
  '`',
  '```',
  '~~~',
  '[',
  ']',
  '(',
  ')',
  '![',
  '](',
  '<',
  '>',
  '</',
  '<a',
  '<Card',
  '<img',
  '[!NOTE]',
  '---',
  '***',
  '===',
];

describe('stripMarkdown', () => {
  it('reads like the regex chain it replaced, on generated Markdown', () => {
    const next = random(11);
    for (let index = 0; index < 8000; index += 1) {
      const text = Array.from({ length: Math.floor(next() * 50) }, () => PIECES[Math.floor(next() * PIECES.length)]).join('');
      expect(stripMarkdown(text), JSON.stringify(text)).toBe(regexStripMarkdown(text));
    }
  });

  it('keeps reading real pages the same way', () => {
    const page = [
      '# Title',
      '',
      '- one',
      '  - two',
      '1. first',
      '',
      '---',
      'Setext',
      '===',
      '> quote with [a link](/x) and ![an image](/i.png)',
      '<Card title="t">Body</Card> and `code`',
      '```js\nconst a = 1;\n```',
    ].join('\n');
    expect(stripMarkdown(page)).toBe(regexStripMarkdown(page));
  });
});
