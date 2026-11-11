/**
 * Detects a page whose prose is written in a different script from the
 * language it is published under: mostly Arabic on an English page, mostly
 * Latin on an Arabic page. Meant for the editor's pre-publish checks; it parses
 * Markdown, so it lives apart from the dependency-free reader helpers in
 * ./script-direction.
 */
import type { Nodes, Parents } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

export type WritingScript = 'arabic' | 'hebrew' | 'latin' | 'cyrillic' | 'greek' | 'han' | 'kana' | 'hangul' | 'devanagari' | 'thai' | 'other';

const SCRIPT_PATTERNS: Array<[Exclude<WritingScript, 'other'>, RegExp]> = [
  ['latin', /\p{Script=Latin}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['hebrew', /\p{Script=Hebrew}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['greek', /\p{Script=Greek}/u],
  ['han', /\p{Script=Han}/u],
  ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ['hangul', /\p{Script=Hangul}/u],
  ['devanagari', /\p{Script=Devanagari}/u],
  ['thai', /\p{Script=Thai}/u],
];
/** Scripts with letter case, where a capital marks a name or an acronym. */
const CASED_SCRIPTS = new Set<WritingScript>(['latin', 'cyrillic', 'greek']);
const LETTER = /\p{L}/u;
const UPPER = /\p{Lu}/u;
const DIGIT = /\p{Nd}/u;

const scriptOf = (char: string): WritingScript => {
  // Fast path: ASCII letters are Latin, without running the Unicode script regexes.
  const code = char.charCodeAt(0);
  if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) return 'latin';
  return SCRIPT_PATTERNS.find(([, pattern]) => pattern.test(char))?.[0] ?? 'other';
};

/** Scripts a language's prose is expected to be written in, by primary subtag. */
const LANGUAGE_SCRIPTS: Record<string, readonly WritingScript[]> = {
  ar: ['arabic'],
  fa: ['arabic'],
  ur: ['arabic'],
  ps: ['arabic'],
  ckb: ['arabic'],
  sd: ['arabic'],
  ug: ['arabic'],
  he: ['hebrew'],
  iw: ['hebrew'],
  yi: ['hebrew'],
  ru: ['cyrillic'],
  uk: ['cyrillic'],
  bg: ['cyrillic'],
  be: ['cyrillic'],
  mk: ['cyrillic'],
  kk: ['cyrillic'],
  sr: ['cyrillic', 'latin'],
  el: ['greek'],
  zh: ['han'],
  ja: ['han', 'kana'],
  ko: ['hangul', 'han'],
  hi: ['devanagari'],
  mr: ['devanagari'],
  ne: ['devanagari'],
  th: ['thai'],
};

const LATIN_LANGUAGES = new Set(
  'af ca cs cy da de en eo es et eu fi fil fr ga gl hr hu id is it lt lv ms mt nb nl nn no pl pt ro sk sl sq sv sw tl tr vi'.split(' '),
);

const expectedScripts = (languageCode: string): readonly WritingScript[] | undefined => {
  const parts = languageCode.toLowerCase().split(/[-_]/);
  const primary = parts[0] ?? '';
  const script = parts.find((part, index) => index > 0 && part.length === 4);
  if (script === 'latn') return ['latin'];
  if (script === 'arab') return ['arabic'];
  if (script === 'cyrl') return ['cyrillic'];
  if (script === 'hans' || script === 'hant') return ['han'];
  return LANGUAGE_SCRIPTS[primary] ?? (LATIN_LANGUAGES.has(primary) ? ['latin'] : undefined);
};

/** Raw HTML elements whose text is code or markup, never prose. */
const NON_PROSE_TAGS = new Set(['code', 'kbd', 'math', 'pre', 'samp', 'script', 'style', 'svg', 'textarea', 'var']);
/** Raw HTML elements that end a run of prose. */
const BLOCK_TAGS = new Set(
  'address article aside blockquote br dd details div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p section summary table td th tr ul'.split(
    ' ',
  ),
);
/** One HTML tag. `[^<>]*` stops at the next `<`, so scanning stays linear. */
const HTML_TAG = /<(\/?)([A-Za-z][\w:-]*)[^<>]*>/y;

/**
 * The prose of a Markdown/MDX page, split into runs at block boundaries: code
 * (fenced, indented, inline, raw `<pre>`/`<code>`), raw HTML tags and their
 * attributes, link and image destinations, bare URLs and emails (GFM autolinks)
 * and link definitions are left out.
 */
function proseRuns(markdown: string): string[] {
  const runs: string[] = [];
  let current = '';
  let codeDepth = 0;
  const flush = () => {
    if (current.trim()) runs.push(current);
    current = '';
  };
  const append = (text: string) => {
    if (codeDepth === 0) current += text;
  };
  const html = (value: string) => {
    let index = 0;
    while (index < value.length) {
      const open = value.indexOf('<', index);
      append(value.slice(index, open === -1 ? value.length : open));
      if (open === -1) break;
      if (value.startsWith('<!--', open)) {
        const close = value.indexOf('-->', open + 4);
        index = close === -1 ? value.length : close + 3;
        continue;
      }
      HTML_TAG.lastIndex = open;
      const tag = HTML_TAG.exec(value);
      if (!tag) {
        append('<');
        index = open + 1;
        continue;
      }
      index = HTML_TAG.lastIndex;
      const name = (tag[2] ?? '').toLowerCase();
      const closing = tag[1] === '/';
      if (NON_PROSE_TAGS.has(name) && !tag[0].endsWith('/>')) codeDepth = closing ? Math.max(0, codeDepth - 1) : codeDepth + 1;
      if (BLOCK_TAGS.has(name)) flush();
    }
  };
  const visit = (node: Nodes): void => {
    switch (node.type) {
      case 'code':
      case 'inlineCode':
      case 'definition':
      case 'image':
      case 'imageReference':
        return;
      case 'text':
        append(node.value);
        return;
      case 'html':
        html(node.value);
        return;
      case 'break':
      case 'thematicBreak':
        flush();
        return;
      case 'link': {
        // A bare URL or email (GFM autolink) shows its own destination as text.
        const text = node.children.map((child) => ('value' in child ? child.value : '')).join('');
        if (text === node.url || `mailto:${text}` === node.url || `http://${text}` === node.url) return;
        break;
      }
      default:
    }
    if (!('children' in node)) return;
    const inline =
      node.type === 'emphasis' || node.type === 'strong' || node.type === 'delete' || node.type === 'link' || node.type === 'linkReference';
    if (!inline) flush();
    for (const child of (node as Parents).children) visit(child);
    if (!inline) flush();
  };
  visit(fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }));
  flush();
  return runs;
}

// ─── Cost bounds ─────────────────────────────────────────────────────────────
// This runs at publish time on every page, so it must never block: script
// detection needs a representative sample, not the whole document.

/** First window plus middle and end windows, each cut at a line boundary. */
const SAMPLE_WINDOWS = [8192, 4096, 4096] as const;
/** An ASCII-only, whitespace-free token this long is a URL, email, hash or junk,
 *  never a prose word. Non-ASCII runs are kept: CJK and Thai prose has no spaces. */
const MAX_TOKEN = 64;

const isAscii = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) return false;
  }
  return true;
};
/** Above this many Markdown markers in the sample, micromark can go superlinear
 *  (as #453 found), so prose is extracted with a linear scan instead. */
const MAX_MARKERS = 400;
const MARKERS = new Set(['*', '_', '[', ']', '<', '>', '{', '}', '`', '!', '~', '|']);
const WHITESPACE = new Set([' ', '\n', '\t', '\r']);

const lineCut = (value: string, start: number, size: number): string => {
  if (start >= value.length) return '';
  const begin = start <= 0 ? 0 : value.indexOf('\n', start) + 1 || value.length;
  const end = Math.min(value.length, begin + size);
  const lastBreak = value.lastIndexOf('\n', end);
  return value.slice(begin, end === value.length || lastBreak <= begin ? end : lastBreak);
};

/** Replaces whitespace-free runs longer than MAX_TOKEN with a space, in one pass. */
const dropLongTokens = (value: string): string => {
  let output = '';
  let tokenStart = 0;
  for (let index = 0; index <= value.length; index += 1) {
    const char = value[index];
    if (char === undefined || WHITESPACE.has(char)) {
      const token = value.slice(tokenStart, index);
      // Only long ASCII runs (URLs, emails, hashes, junk) are dropped. Chinese,
      // Japanese and Thai write whole sentences without spaces, so a long
      // non-ASCII run is prose and must be kept. The sample is already capped at
      // 16 KB, so keeping it stays cheap.
      output += token.length > MAX_TOKEN && isAscii(token) ? ' ' : token;
      if (char !== undefined) output += char;
      tokenStart = index + 1;
    }
  }
  return output;
};

/** A bounded, linear-time sample of the page: first, middle and last windows. */
export const sampleForScript = (markdown: string): string => {
  const [first, middle, last] = SAMPLE_WINDOWS;
  if (markdown.length <= first + middle + last) return dropLongTokens(markdown);
  const windows = [
    lineCut(markdown, 0, first),
    lineCut(markdown, Math.floor(markdown.length / 2 - middle / 2), middle),
    lineCut(markdown, markdown.length - last, last),
  ];
  return dropLongTokens(windows.join('\n\n'));
};

const markerCount = (value: string): number => {
  let markers = 0;
  for (const char of value) if (MARKERS.has(char)) markers += 1;
  return markers;
};

/** Linear fallback for marker-dense samples: drop fenced and indented code,
 *  tags and inline code, then treat each line as a run. Never parses. */
const linearProseRuns = (markdown: string): string[] => {
  const runs: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker && (!fence || marker.startsWith(fence))) {
      fence = fence ? null : marker;
      continue;
    }
    if (fence || /^(?: {4}|\t)/u.test(line)) continue;
    let text = '';
    let inCode = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index] ?? '';
      if (char === '`') {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;
      if (char === '<') {
        const end = line.indexOf('>', index + 1);
        if (end !== -1) {
          text += ' ';
          index = end;
          continue;
        }
      }
      text += MARKERS.has(char) || char === '#' ? ' ' : char;
    }
    if (text.trim()) runs.push(text);
  }
  return runs;
};

/** Sentences: names inside a sentence are judged against that sentence's words. */
const SENTENCE_END = /[.!?؟。！？]+(?=\s|$)|[\n\r]+/u;

interface Word {
  script: WritingScript;
  letters: Map<WritingScript, number>;
  name: boolean;
}

const readWord = (token: string): Word | undefined => {
  const letters = new Map<WritingScript, number>();
  let first: string | undefined;
  let innerCapital = false;
  let digit = false;
  for (const char of token) {
    if (DIGIT.test(char)) digit = true;
    if (!LETTER.test(char)) continue;
    if (first === undefined) first = char;
    else if (UPPER.test(char)) innerCapital = true;
    const script = scriptOf(char);
    letters.set(script, (letters.get(script) ?? 0) + 1);
  }
  if (first === undefined) return undefined;
  const script = scriptOf(first);
  return { script, letters, name: CASED_SCRIPTS.has(script) && (UPPER.test(first) || innerCapital || digit) };
};

export interface ScriptMismatchOptions {
  /** Below this many counted letters a page is too short to judge. Default 20. */
  minLetters?: number;
  /** Share of counted letters the dominant script must reach to count as a mismatch. Default 0.6. */
  threshold?: number;
}

export interface ScriptMismatch {
  /** The prose is mostly written in a script the language does not use. */
  mismatch: boolean;
  /** The script most counted letters are written in, or null when nothing was counted. */
  dominantScript: WritingScript | null;
  /** The dominant script's share of counted letters, 0–1. */
  ratio: number;
}

/**
 * Whether a page's content looks like it is in a different language from the
 * one it is published under.
 *
 * `markdown` is the page's Markdown/MDX source; only its prose is read (see
 * proseRuns). Letters are counted per script, with one calibration for
 * technical writing: a capitalized word, acronym or identifier (`Kubernetes`,
 * `API`, `OpenTelemetry`, `v2`) in a cased script, inside a sentence that also
 * has words in another script, is a name embedded in that sentence and is not
 * counted. Lowercase prose always counts, so English sentences on an Arabic
 * page are still caught, and Arabic sentences that name Latin products on an
 * English page are too. Short pages and languages whose script is unknown never
 * report a mismatch.
 */
export function detectScriptMismatch(markdown: string, languageCode: string, options: ScriptMismatchOptions = {}): ScriptMismatch {
  const { minLetters = 20, threshold = 0.6 } = options;
  const counts = new Map<WritingScript, number>();
  let counted = 0;
  const sample = sampleForScript(markdown);
  const runs = markerCount(sample) > MAX_MARKERS ? linearProseRuns(sample) : proseRuns(sample);
  for (const run of runs) {
    for (const sentence of run.split(SENTENCE_END)) {
      const words = sentence
        .split(/\s+/)
        .map(readWord)
        .filter((word) => word !== undefined);
      const scripts = new Set(words.map((word) => word.script));
      for (const word of words) {
        if (word.name && scripts.size > 1) continue;
        for (const [script, count] of word.letters) {
          counts.set(script, (counts.get(script) ?? 0) + count);
          counted += count;
        }
      }
    }
  }
  let dominantScript: WritingScript | null = null;
  let dominantCount = 0;
  for (const [script, count] of counts) {
    if (count > dominantCount) {
      dominantScript = script;
      dominantCount = count;
    }
  }
  const ratio = counted === 0 ? 0 : dominantCount / counted;
  const expected = expectedScripts(languageCode);
  const mismatch =
    expected !== undefined &&
    dominantScript !== null &&
    dominantScript !== 'other' &&
    counted >= minLetters &&
    ratio >= threshold &&
    !expected.includes(dominantScript);
  return { mismatch, dominantScript, ratio };
}
