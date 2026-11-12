import { describe, expect, it } from 'vitest';
import {
  forwardIndexOf,
  markdownAndHtmlImages,
  matchTags,
  replaceMarkdownImages,
  replaceMarkdownImageTargets,
  replaceMarkdownLinksWithLabels,
  replaceScriptAndStyleElements,
  replaceTagAttributes,
  replaceTags,
} from './markup-scan';

const random = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
};

/** Short texts built from the pieces these patterns care about, so every way a
 *  match can start, close, fail or nest comes up many times. */
const PIECES = [
  '<',
  '>',
  '/',
  '!',
  '[',
  ']',
  '(',
  ')',
  '"',
  "'",
  ' ',
  '\n',
  'x',
  'a',
  '=',
  '<img',
  '<IMG',
  '<Image',
  '<a',
  '<A',
  '<abbr',
  '<File',
  '<Icon',
  '<RelatedCard',
  '<b',
  'href="',
  'src="',
  "src='",
  'src =',
  '/>',
  '![',
  '](',
  'alt="y"',
];
const texts = (count: number, seed: number): string[] => {
  const next = random(seed);
  return Array.from({ length: count }, () =>
    Array.from({ length: Math.floor(next() * 40) }, () => PIECES[Math.floor(next() * PIECES.length)]).join(''),
  );
};
const CASES = texts(6000, 7);
const show = (match: string, ...groups: string[]) => `{${[match, ...groups].join('|')}}`;

describe('linear tag and link scanning gives exactly what the regex gives', () => {
  it.each([/<[^>]+>/g, /<\/?[A-Za-z][^>]*>/g, /<img\b[^>]*>/gi, /<img\b[^>]*\/?>/gi])('replaceTags: %s', (pattern) => {
    for (const text of CASES) {
      expect(replaceTags(text, pattern, ' '), text).toBe(text.replace(pattern, ' '));
      expect(replaceTags(text, pattern, show), text).toBe(text.replace(pattern, (match) => show(match)));
    }
  });

  it('matchTags: /<img\\b[^>]*>/gi', () => {
    for (const text of CASES) {
      const found = matchTags(text, /<img\b[^>]*>/gi).map((match) => [match[0], match.index]);
      expect(found, text).toEqual([...text.matchAll(/<img\b[^>]*>/gi)].map((match) => [match[0], match.index]));
    }
  });

  it.each([
    [/<a\b/gi, /(<a\b[^>]*\bhref=")([^"]*)(")/giy],
    [/<img\b/gi, /(<img\b[^>]*\bsrc=")([^"]*)(")/giy],
    [/<(?:img|Image)\b/gi, /(<(?:img|Image)\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'])/giy],
    [/<(?:File|RelatedCard|Icon)\b/gi, /<(File|RelatedCard|Icon)\b([^>]*)\/>/giy],
  ])('replaceTagAttributes: %s', (opener, sticky) => {
    const global = new RegExp(sticky.source, 'gi');
    for (const text of CASES) {
      expect(replaceTagAttributes(text, opener, sticky, show), text).toBe(
        text.replace(global, (match, ...rest) => show(match, ...rest.slice(0, -2).map((group) => group ?? ''))),
      );
    }
  });

  it('replaceMarkdownImages: /!\\[[^\\]]*\\]\\([^)]*\\)/g', () => {
    for (const text of CASES) expect(replaceMarkdownImages(text, ' '), text).toBe(text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' '));
  });

  it('replaceMarkdownLinksWithLabels: /\\[([^\\]]+)\\]\\([^)]*\\)/g', () => {
    for (const text of CASES) expect(replaceMarkdownLinksWithLabels(text), text).toBe(text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'));
  });

  it('markdownAndHtmlImages: /!\\[[^\\]]*\\]\\([^)]*\\)|<img\\b[^>]*>/gi', () => {
    for (const text of CASES) expect(markdownAndHtmlImages(text), text).toEqual(text.match(/!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>/gi) ?? []);
  });

  it('replaceMarkdownImageTargets: /(!\\[[^\\]]*\\]\\()([^\\s)]+)((?:\\s+["\'][^)]*["\'])?\\))/g', () => {
    const pattern = /(!\[[^\]]*\]\()([^\s)]+)((?:\s+["'][^)]*["'])?\))/g;
    for (const text of [...CASES, ...texts(6000, 23).map((text) => text.replaceAll('<', '![').replaceAll('>', ']('))]) {
      expect(
        replaceMarkdownImageTargets(text, (before, target, after) => `{${before}|${target}|${after}}`),
        text,
      ).toBe(text.replace(pattern, (_match, before, target, after) => `{${before}|${target}|${after}}`));
    }
  });

  it('replaceScriptAndStyleElements: /<(script|style)[\\s\\S]*?<\\/\\1>/gi', () => {
    const next = random(31);
    const pieces = [
      '<script',
      '<SCRIPT',
      '<style',
      '<Style',
      '</script>',
      '</SCRIPT>',
      '</style>',
      '</styles>',
      '<scriptx',
      'a',
      '\n',
      ' ',
      '<',
      '>',
    ];
    for (let index = 0; index < 6000; index += 1) {
      const text = Array.from({ length: Math.floor(next() * 30) }, () => pieces[Math.floor(next() * pieces.length)]).join('');
      expect(replaceScriptAndStyleElements(text, ' '), text).toBe(text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' '));
    }
  });

  it('forwardIndexOf answers like indexOf for forward and backward starts', () => {
    const text = 'a>b>>c';
    const find = forwardIndexOf(text, '>');
    for (const from of [0, 1, 2, 2, 3, 4, 5, 6, 1, 0, 6, 9]) expect(find(from), String(from)).toBe(text.indexOf('>', from));
  });
});
