/**
 * Writing-direction helpers for published content. Dependency-free, so the
 * reader can use them on every public page.
 *
 * Everything here is a pure function of its input, so a server render and the
 * client hydrating it compute the same attributes.
 */

export type TextDirection = 'ltr' | 'rtl';

/**
 * Code point blocks whose letters have the right-to-left bidi classes R or AL.
 * JavaScript regular expressions cannot match `Bidi_Class`, and matching by
 * script gets it wrong: tatweel (U+0640) is a Common-script letter but bidi AL,
 * and Hanifi Rohingya sits outside the Arabic script property. These are the
 * blocks Unicode assigns R/AL by default (DerivedBidiClass), so every letter
 * in them, assigned now or later, is right to left.
 */
const RTL_BLOCKS: ReadonlyArray<readonly [number, number]> = [
  [0x0590, 0x08ff], // Hebrew, Arabic, Syriac, Arabic Supplement, Thaana, NKo, Samaritan, Mandaic, Syriac Supplement, Arabic Extended-B/A
  [0xfb1d, 0xfdff], // Hebrew presentation forms, Arabic Presentation Forms-A
  [0xfe70, 0xfeff], // Arabic Presentation Forms-B
  [0x10800, 0x10fff], // Cypriot … Hanifi Rohingya, Yezidi, Arabic Extended-C, Sogdian, Old Uyghur, Elymaic
  [0x1e800, 0x1efff], // Mende Kikakui, Adlam, Indic/Ottoman Siyaq, Arabic Mathematical Alphabetic Symbols
];
const LETTER = /\p{L}/u;
const SPACE = /\s/u;

/**
 * Direction of one character when it is a strong letter, else undefined.
 * Letters in RTL_BLOCKS are right to left, every other letter left to right;
 * digits, marks, punctuation and symbols are weak or neutral and never count.
 */
const letterDirection = (char: string): TextDirection | undefined => {
  if (!LETTER.test(char)) return undefined;
  const code = char.codePointAt(0) ?? 0;
  return RTL_BLOCKS.some(([start, end]) => code >= start && code <= end) ? 'rtl' : 'ltr';
};

/** Primary language subtags written right to left by default. */
const RTL_LANGUAGES = new Set(['ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'iw', 'ks', 'nqo', 'ps', 'rhg', 'sd', 'syr', 'ug', 'ur', 'yi']);
const RTL_SCRIPTS = new Set(['adlm', 'arab', 'hebr', 'nkoo', 'rohg', 'syrc', 'thaa']);

/** Whether a language code (BCP 47) is written right to left by default. An
 *  explicit script subtag wins: `az-Arab` is RTL, `ku-Latn` is not. */
export function isRtlLanguage(code: string | null | undefined): boolean {
  if (!code) return false;
  const parts = code.toLowerCase().split(/[-_]/);
  const script = parts.find((part, index) => index > 0 && part.length === 4);
  if (script) return RTL_SCRIPTS.has(script);
  return RTL_LANGUAGES.has(parts[0] ?? '');
}

/**
 * Word statistics of a run of text: the direction of its first strong letter
 * (what `dir="auto"` resolves to) and how many words start in each direction.
 * A word's direction is that of its first strong letter.
 */
export interface DirectionTally {
  first?: TextDirection;
  rtl: number;
  ltr: number;
}

export const EMPTY_TALLY: DirectionTally = Object.freeze({ rtl: 0, ltr: 0 });

/** Tally one run of text in a single pass. */
export function tallyText(text: string): DirectionTally {
  let first: TextDirection | undefined;
  let rtl = 0;
  let ltr = 0;
  let wordDecided = false;
  for (const char of text) {
    if (SPACE.test(char)) {
      wordDecided = false;
      continue;
    }
    if (wordDecided) continue;
    const direction = letterDirection(char);
    if (!direction) continue;
    wordDecided = true;
    first ??= direction;
    if (direction === 'rtl') rtl += 1;
    else ltr += 1;
  }
  return { first, rtl, ltr };
}

/** The tally of `a` followed by `b`, where a word boundary separates them. */
export const mergeTallies = (a: DirectionTally, b: DirectionTally): DirectionTally => ({
  first: a.first ?? b.first,
  rtl: a.rtl + b.rtl,
  ltr: a.ltr + b.ltr,
});

/** The direction most words start in; undefined when tied or empty. */
export const tallyMajority = (tally: DirectionTally): TextDirection | undefined =>
  tally.rtl > tally.ltr ? 'rtl' : tally.ltr > tally.rtl ? 'ltr' : undefined;

/** blockDirection for an existing tally. */
export function tallyBlockDirection(tally: DirectionTally): 'auto' | TextDirection | undefined {
  const majority = tallyMajority(tally);
  if (!tally.first || !majority) return undefined;
  return majority === tally.first ? 'auto' : majority;
}

/** Direction of the first strong letter, as `dir="auto"` would resolve it. */
export function firstStrongDirection(text: string): TextDirection | undefined {
  for (const char of text) {
    const direction = letterDirection(char);
    if (direction) return direction;
  }
  return undefined;
}

/** The direction most words of a text are written in, or undefined when the
 *  text has no letters or is evenly split (then the surrounding direction should win). */
export function dominantDirection(text: string): TextDirection | undefined {
  return tallyMajority(tallyText(text));
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
  return tallyBlockDirection(tallyText(text));
}
