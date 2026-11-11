/**
 * Writing-direction and writing-script helpers for published content.
 *
 * Everything here is a pure function of its input, so a server render and the
 * client hydrating it compute the same attributes.
 */

export type TextDirection = 'ltr' | 'rtl';

/** Scripts written right to left. Arabic digits are not letters, so they never count. */
const RTL_LETTER =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}\p{Script=Samaritan}\p{Script=Mandaic}]/u;
const LETTER = /\p{L}/u;

/** Primary language subtags written right to left by default. */
const RTL_LANGUAGES = new Set(['ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'iw', 'ks', 'nqo', 'ps', 'sd', 'syr', 'ug', 'ur', 'yi']);

/** Whether a language code (BCP 47) is written right to left by default. An
 *  explicit script subtag wins: `az-Arab` is RTL, `ku-Latn` is not. */
export function isRtlLanguage(code: string | null | undefined): boolean {
  if (!code) return false;
  const parts = code.toLowerCase().split(/[-_]/);
  const script = parts.find((part, index) => index > 0 && part.length === 4);
  if (script) return ['arab', 'hebr', 'syrc', 'thaa', 'nkoo', 'adlm'].includes(script);
  return RTL_LANGUAGES.has(parts[0] ?? '');
}

/** Direction of one character when it is a strong letter, else undefined. */
const letterDirection = (char: string): TextDirection | undefined => {
  if (!LETTER.test(char)) return undefined;
  return RTL_LETTER.test(char) ? 'rtl' : 'ltr';
};

/** Direction of the first strong letter, as `dir="auto"` would resolve it. */
export function firstStrongDirection(text: string): TextDirection | undefined {
  for (const char of text) {
    const direction = letterDirection(char);
    if (direction) return direction;
  }
  return undefined;
}

interface DirectionStats {
  first: TextDirection | undefined;
  /** The direction most words start in; undefined when tied or empty. */
  majority: TextDirection | undefined;
}

const directionStats = (text: string): DirectionStats => {
  let first: TextDirection | undefined;
  let rtl = 0;
  let ltr = 0;
  for (const word of text.split(/\s+/)) {
    const direction = firstStrongDirection(word);
    if (!direction) continue;
    first ??= direction;
    if (direction === 'rtl') rtl += 1;
    else ltr += 1;
  }
  return { first, majority: rtl > ltr ? 'rtl' : ltr > rtl ? 'ltr' : undefined };
};

/** The direction most words of a text are written in, or undefined when the
 *  text has no letters or is evenly split (then the surrounding direction should win). */
export function dominantDirection(text: string): TextDirection | undefined {
  return directionStats(text).majority;
}

/**
 * The `dir` attribute for a block of text (a paragraph, a heading, a nav label).
 *
 * `auto` lets the browser lay the block out by its first strong letter, which is
 * right for almost every block. It is wrong when a block opens with a word in
 * the minority script, typical of technical Arabic ("Nibleaf يتيح لك …"): there
 * the direction most words are written in is returned explicitly instead. Text
 * with no letters, or evenly split, gets no attribute and inherits.
 */
export function blockDirection(text: string): 'auto' | TextDirection | undefined {
  const { first, majority } = directionStats(text);
  if (!first || !majority) return undefined;
  return majority === first ? 'auto' : majority;
}

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

const scriptOf = (char: string): WritingScript => SCRIPT_PATTERNS.find(([, pattern]) => pattern.test(char))?.[0] ?? 'other';

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

/** Code, URLs, markup and link targets are written in Latin whatever the prose language. */
const proseOnly = (text: string): string =>
  text
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\]\([^)]*\)/g, '] ')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/\S+@\S+\.\S+/g, ' ');

export interface ScriptMismatchOptions {
  /** Below this many letters a text is too short to judge. Default 20. */
  minLetters?: number;
  /** Share of letters the dominant script must reach to count as a mismatch. Default 0.6. */
  threshold?: number;
}

export interface ScriptMismatch {
  /** The text is mostly written in a script the language does not use. */
  mismatch: boolean;
  /** The script most letters are written in, or null for text without letters. */
  dominantScript: WritingScript | null;
  /** The dominant script's share of all letters, 0–1. */
  ratio: number;
}

/**
 * Whether a page's content looks like it is in a different language from the
 * one it is published under: mostly Arabic script on an English page, or
 * mostly Latin script on an Arabic page. Code, URLs and markup are ignored, and
 * Latin product names inside Arabic prose do not count against it. Short text
 * and languages whose script is unknown never report a mismatch.
 */
export function detectScriptMismatch(text: string, languageCode: string, options: ScriptMismatchOptions = {}): ScriptMismatch {
  const { minLetters = 20, threshold = 0.6 } = options;
  const counts = new Map<WritingScript, number>();
  let letters = 0;
  for (const char of proseOnly(text)) {
    if (!LETTER.test(char)) continue;
    letters += 1;
    const script = scriptOf(char);
    counts.set(script, (counts.get(script) ?? 0) + 1);
  }
  let dominantScript: WritingScript | null = null;
  let dominantCount = 0;
  for (const [script, count] of counts) {
    if (count > dominantCount) {
      dominantScript = script;
      dominantCount = count;
    }
  }
  const ratio = letters === 0 ? 0 : dominantCount / letters;
  const expected = expectedScripts(languageCode);
  const mismatch =
    expected !== undefined &&
    dominantScript !== null &&
    dominantScript !== 'other' &&
    letters >= minLetters &&
    ratio >= threshold &&
    !expected.includes(dominantScript);
  return { mismatch, dominantScript, ratio };
}
