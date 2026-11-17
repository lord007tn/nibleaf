import { protectMarkdownCode } from '@nibleaf/shared/markdown-code';
import { describe, expect, it } from 'vitest';
import { articleStats } from './article-stats';

/** The meta line's numbers as they were computed: the regexes `articleStats` must match. */
const regexStats = (content: string) => {
  const readableText = content
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[`#*_>[\](){}|~-]/g, ' ');
  const isDarkModeTwin = (image: string) => {
    const classes = image.match(/\bclass(?:Name)?=\{?["']([^"']*)["']\}?/)?.[1]?.split(/\s+/) ?? [];
    return classes.includes('hidden') && classes.some((name) => name.startsWith('dark:') && name !== 'dark:hidden');
  };
  return {
    readingMinutes: Math.max(1, Math.ceil(readableText.split(/\s+/).filter(Boolean).length / 220)),
    imageCount: (protectMarkdownCode(content).content.match(/!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>/gi) ?? []).filter((image) => !isDarkModeTwin(image))
      .length,
  };
};

const random = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
};
const PIECES = [
  '<',
  '>',
  '![',
  '](',
  '[',
  ']',
  '(',
  ')',
  '<img',
  '<IMG ',
  'class="hidden dark:block"',
  'class="dark:hidden"',
  '`',
  '```',
  'word ',
  'x',
  '\n',
  ' ',
];

describe('articleStats', () => {
  it('counts what the regexes counted, on generated pages', () => {
    const next = random(3);
    for (let index = 0; index < 6000; index += 1) {
      const content = Array.from({ length: Math.floor(next() * 60) }, () => PIECES[Math.floor(next() * PIECES.length)]).join('');
      expect(articleStats(content), JSON.stringify(content)).toEqual(regexStats(content));
    }
  });

  it('counts a light/dark pair once and skips images in code', () => {
    const content = [
      '![One](/one.png)',
      '<img src="/light.png" class="dark:hidden" />',
      '<img src="/dark.png" class="hidden dark:block" />',
      '```md\n![Not an image](/x.png)\n```',
      'words '.repeat(500),
    ].join('\n\n');
    expect(articleStats(content)).toEqual({ readingMinutes: 3, imageCount: 2 });
    expect(articleStats(content)).toEqual(regexStats(content));
  });
});
