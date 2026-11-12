import { describe, expect, it } from 'vitest';
import {
  collapseLineBreakRuns,
  forwardIndexOf,
  hasTextOutsideComments,
  inlineCodeSpans,
  markdownAndHtmlImages,
  markdownCodeSpans,
  matchOneLineElement,
  matchTags,
  removeMdxCommentsOutsideCode,
  replaceElements,
  replaceMarkdownImages,
  replaceMarkdownImageTargets,
  replaceMarkdownLinksWithLabels,
  replaceScriptAndStyleElements,
  replaceSelfClosingTags,
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

  it('hasTextOutsideComments: splitting on HTML and MDX comments', () => {
    const next = random(41);
    const pieces = ['<!--', '-->', '{/*', '*/}', '<!-->', '{/*/}', ' ', '\n', 'x', '-', '*', '{', '}', '/', '<', '>', '!'];
    for (let index = 0; index < 8000; index += 1) {
      const text = Array.from({ length: Math.floor(next() * 24) }, () => pieces[Math.floor(next() * pieces.length)]).join('');
      const expected = text.split(/<!--[\s\S]*?-->|\{\/\*[\s\S]*?\*\/\}/).some((part) => part.trim().length > 0);
      expect(hasTextOutsideComments(text), JSON.stringify(text)).toBe(expected);
    }
  });

  it.each([['pre'], ['code']])('replaceElements: /<%s[\\s\\S]*?<\\/%s>/gi', (name) => {
    const next = random(47);
    const pieces = [
      `<${name}`,
      `<${name.toUpperCase()}`,
      `</${name}>`,
      `</${name.toUpperCase()}>`,
      `</${name}`,
      `<${name}x`,
      'a',
      '\n',
      ' ',
      '<',
      '>',
    ];
    const pattern = new RegExp(`<${name}[\\s\\S]*?<\\/${name}>`, 'gi');
    for (let index = 0; index < 6000; index += 1) {
      const text = Array.from({ length: Math.floor(next() * 30) }, () => pieces[Math.floor(next() * pieces.length)]).join('');
      expect(replaceElements(text, [name], ' '), text).toBe(text.replace(pattern, ' '));
    }
  });

  it('collapseLineBreakRuns:/\\s*\\n\\s*/g → \\n', () => {
    const next = random(43);
    const pieces = [' ', '\t', '\n', '\r', '\u00a0', '\u2028', '\u3000', 'x', 'y'];
    for (let index = 0; index < 8000; index += 1) {
      const text = Array.from({ length: Math.floor(next() * 30) }, () => pieces[Math.floor(next() * pieces.length)]).join('');
      expect(collapseLineBreakRuns(text), JSON.stringify(text)).toBe(text.replace(/\s*\n\s*/g, '\n'));
    }
  });

  it('inlineCodeSpans: /(`+)[\\s\\S]*?\\1/g', () => {
    const next = random(53);
    const pieces = ['`', '`', '``', '```', 'a', ' ', '\n', '{'];
    for (let index = 0; index < 8000; index += 1) {
      const text = Array.from({ length: Math.floor(next() * 30) }, () => pieces[Math.floor(next() * pieces.length)]).join('');
      const expected = [...text.matchAll(/(`+)[\s\S]*?\1/g)].map((match) => [match.index, match.index + match[0].length]);
      expect(inlineCodeSpans(text), JSON.stringify(text)).toEqual(expected);
    }
  });

  it('markdownCodeSpans: /(`+)(?!`)([\\s\\S]*?[^`])\\1(?!`)/g', () => {
    const next = random(71);
    const pieces = ['`', '`', '``', '```', 'a', ' ', '\n', 'b'];
    for (let index = 0; index < 10_000; index += 1) {
      const text = Array.from({ length: Math.floor(next() * 30) }, () => pieces[Math.floor(next() * pieces.length)]).join('');
      const expected = [...text.matchAll(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g)].map((match) => [match.index, match.index + match[0].length]);
      expect(markdownCodeSpans(text), JSON.stringify(text)).toEqual(expected);
    }
  });

  it('removeMdxCommentsOutsideCode:/(`+)[\\s\\S]*?\\1|\\{\\s*\\/\\*[\\s\\S]*?\\*\\/\\s*\\}/g', () => {
    const next = random(59);
    const pieces = ['`', '``', '{', '}', '/*', '*/', '{/*', '*/}', '/', '*', ' ', '\n', 'a', '{ /*', '*/ }'];
    const pattern = /(`+)[\s\S]*?\1|\{\s*\/\*[\s\S]*?\*\/\s*\}/g;
    for (let index = 0; index < 8000; index += 1) {
      const text = Array.from({ length: Math.floor(next() * 30) }, () => pieces[Math.floor(next() * pieces.length)]).join('');
      const expected = text.replace(pattern, (match, code: string | undefined) => (code ? match : ''));
      expect(removeMdxCommentsOutsideCode(text), JSON.stringify(text)).toBe(expected);
    }
  });

  // The attribute parts reader-markdown.ts reads component tags with.
  const LONE_QUOTE = `"(?![^"\\n]*")|'(?![^'\\n]*')`;
  const PART = `(?:[^>"']|"[^"\\n]*"|'[^'\\n]*'|${LONE_QUOTE})`;
  const OPENING = `(?:${PART}*(?:[^/>"']|"[^"\\n]*"|'[^'\\n]*'|${LONE_QUOTE}))?`;
  const TAG_PIECES = ['"', "'", '"x"', '/', '/>', '>', ' ', '\n', 'a', '=', '<'];

  it('replaceSelfClosingTags: <(names)\\b(PART*?)\\/>', () => {
    const next = random(61);
    const names = ['File', 'Icon', 'Card'];
    const pieces = [...TAG_PIECES, '<File', '<file', '<Icon', '<Files', '<Card'];
    const pattern = new RegExp(`<(${names.join('|')})\\b(${PART}*?)\\/>`, 'gi');
    for (let index = 0; index < 8000; index += 1) {
      const text = Array.from({ length: Math.floor(next() * 30) }, () => pieces[Math.floor(next() * pieces.length)]).join('');
      expect(replaceSelfClosingTags(text, names, show), JSON.stringify(text)).toBe(
        text.replace(pattern, (_match, name, attributes) => show(name, attributes)),
      );
    }
  });

  it('matchOneLineElement: ^(\\s*)<(names)\\b(OPENING)>(.*\\S.*)</\\2>\\s*$', () => {
    const next = random(67);
    const names = ['Card', 'CardGroup', 'Note'];
    const pieces = [
      ...TAG_PIECES.filter((piece) => piece !== '\n'),
      '<Card',
      '<card',
      '<CardGroup',
      '<Note',
      '</Card>',
      '</CARD>',
      '</Note>',
      '</CardGroup>',
      '\t',
      '\r',
      'x',
    ];
    const pattern = new RegExp(`^(\\s*)<(${names.join('|')})\\b(${OPENING})>(.*\\S.*)</\\2>\\s*$`, 'i');
    for (let index = 0; index < 12_000; index += 1) {
      const length = Math.floor(next() * 14);
      const opener = ['<Card', '<card', '<CardGroup', '<Note', '<Cards', 'x'][Math.floor(next() * 6)];
      const text = (next() < 0.5 ? ' ' : '') + opener + Array.from({ length }, () => pieces[Math.floor(next() * pieces.length)]).join('');
      const match = pattern.exec(text);
      const expected = match ? { indent: match[1], name: match[2], attributes: match[3], body: match[4] } : null;
      expect(matchOneLineElement(text, names), JSON.stringify(text)).toEqual(expected);
    }
  });

  it('forwardIndexOf answers like indexOf for forward and backward starts', () => {
    const text = 'a>b>>c';
    const find = forwardIndexOf(text, '>');
    for (const from of [0, 1, 2, 2, 3, 4, 5, 6, 1, 0, 6, 9]) expect(find(from), String(from)).toBe(text.indexOf('>', from));
  });
});
