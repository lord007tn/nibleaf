/**
 * Queries for the slash differential guard (slash-differential.test.ts): single
 * words, no plain spaces, built from block names and keywords with one extra
 * character inserted. The bases (main's block names and keywords, lower-cased,
 * without duplicates or spaces, sorted) are stored in the fixture, which was
 * made by running main's matcher over exactly these queries.
 *
 * Invisible characters and marks are built from their code points, so none of
 * them is written raw in this file.
 */

const fromCodePoints = (...codes: number[]): string[] => codes.map((code) => String.fromCodePoint(code));

/** Every ASCII punctuation character, then common Arabic and Urdu punctuation. */
export const PUNCTUATION = [
  ...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
  '،', // Arabic comma
  '؛', // Arabic semicolon
  '؟', // Arabic question mark
  '٪', // Arabic percent sign
  '٫', // Arabic decimal separator
  '٬', // Arabic thousands separator
  '«',
  '»',
  '۔', // Urdu full stop
];

/** Whitespace other than a plain space, and invisible format characters. */
export const INVISIBLE = fromCodePoints(
  0x09, // tab
  0xa0, // no-break space
  0x20_00,
  0x20_01,
  0x20_02,
  0x20_03,
  0x20_04,
  0x20_05,
  0x20_06,
  0x20_07,
  0x20_08,
  0x20_09,
  0x20_0a, // typographic spaces
  0x30_00, // ideographic space
  0x20_0b, // zero-width space
  0x20_0c, // zero-width non-joiner
  0x20_0d, // zero-width joiner
  0x20_0e, // left-to-right mark
  0x20_0f, // right-to-left mark
);

/** Arabic harakat, shadda, sukun, superscript alef and tatweel. The bases are Latin, so these never sit on an Arabic letter. */
export const ARABIC_MARKS = fromCodePoints(0x06_4b, 0x06_4e, 0x06_4f, 0x06_50, 0x06_51, 0x06_52, 0x06_70, 0x06_40);

/**
 * Latin combining accents, inserted only where they sit on no letter: at the
 * start of a base, alone and doubled. After a letter they are an accent on it,
 * which the slash search ignores by design ("códe" finds Code block).
 */
export const LATIN_ACCENTS = fromCodePoints(0x03_00, 0x03_01, 0x03_08);

/** Every default-ignorable code point (Unicode's Default_Ignorable_Code_Point property, 4,174 of them). */
export const DEFAULT_IGNORABLE: string[] = (() => {
  const property = /^\p{Default_Ignorable_Code_Point}$/u;
  const found: string[] = [];
  for (let code = 0; code <= 0x10_ff_ff; code += 1) {
    if (code >= 0xd8_00 && code <= 0xdf_ff) continue;
    const char = String.fromCodePoint(code);
    if (property.test(char)) found.push(char);
  }
  return found;
})();

/**
 * One or two default-ignorables from each range, inserted at every position of
 * every base (the full set goes into DEFAULT_IGNORABLE_BASES only; see below).
 * U+200B–U+200F are already in INVISIBLE.
 */
export const DEFAULT_IGNORABLE_SAMPLE = fromCodePoints(
  0xad, // soft hyphen
  0x03_4f, // combining grapheme joiner
  0x06_1c, // Arabic letter mark
  0x11_5f,
  0x11_60, // Hangul fillers
  0x17_b4,
  0x17_b5, // Khmer inherent vowels
  0x18_0b,
  0x18_0e,
  0x18_0f, // Mongolian variation selectors and vowel separator
  0x20_2a,
  0x20_2e, // bidi embeddings and overrides
  0x20_60,
  0x20_64,
  0x20_66,
  0x20_6f, // word joiner, invisible operators, isolates, nominal digit shapes
  0x31_64, // Hangul filler
  0xfe_00,
  0xfe_0f, // variation selectors
  0xfe_ff, // zero-width no-break space
  0xff_a0, // halfwidth Hangul filler
  0x1_bc_a0, // shorthand format letter overlap
  0x1_d1_73, // musical symbol begin beam
  0xe_00_01,
  0xe_00_20, // tags
  0xe_01_00,
  0xe_01_ef, // variation selectors supplement
  0xe_0f_ff, // last reserved default-ignorable
);

/** Bases that get EVERY default-ignorable code point at every position, including after letters ("co" + CGJ + "de"). */
export const DEFAULT_IGNORABLE_BASES = ['code', 'note', 'h1'];

/** Characters inserted at every position of every base. */
const EVERYWHERE = [...PUNCTUATION, ...INVISIBLE, ...ARABIC_MARKS, ...DEFAULT_IGNORABLE_SAMPLE];

interface DifferentialQuery {
  /** '' for a query of the inserted character alone or doubled. */
  base: string;
  char: string;
  position: number;
  query: string;
}

const inserted = (base: string, char: string, position: number): DifferentialQuery => ({
  base,
  char,
  position,
  query: `${base.slice(0, position)}${char}${base.slice(position)}`,
});

/** Each character inserted into each base (see above for where), then each character alone and doubled. */
export function* differentialQueries(bases: string[]): Generator<DifferentialQuery> {
  for (const base of bases) {
    for (const char of EVERYWHERE) for (let position = 0; position <= base.length; position += 1) yield inserted(base, char, position);
    for (const char of LATIN_ACCENTS) yield inserted(base, char, 0);
  }
  for (const char of [...EVERYWHERE, ...LATIN_ACCENTS]) {
    yield { base: '', char, position: 0, query: char };
    yield { base: '', char, position: 1, query: `${char}${char}` };
  }
}

/** Every default-ignorable code point at every position of each of DEFAULT_IGNORABLE_BASES. */
export function* defaultIgnorableQueries(): Generator<DifferentialQuery> {
  for (const base of DEFAULT_IGNORABLE_BASES)
    for (const char of DEFAULT_IGNORABLE) for (let position = 0; position <= base.length; position += 1) yield inserted(base, char, position);
}
