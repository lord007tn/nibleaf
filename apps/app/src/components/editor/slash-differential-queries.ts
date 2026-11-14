/**
 * Queries for the slash differential guard (slash-differential.test.ts): single
 * words, no plain spaces, built from block names and keywords with one extra
 * character inserted. The bases (main's block names and keywords, lower-cased,
 * without duplicates or spaces, sorted) are stored in the fixture, which was
 * made by running main's matcher over exactly these queries.
 */

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
export const INVISIBLE = [
  '\t',
  ' ', // no-break space
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ', // typographic spaces
  '　', // ideographic space
  '​', // zero-width space
  '‌', // zero-width non-joiner
  '‍', // zero-width joiner
  '‎', // left-to-right mark
  '‏', // right-to-left mark
];

/** Arabic harakat, shadda, sukun, superscript alef and tatweel. The bases are Latin, so these never sit on an Arabic letter. */
export const ARABIC_MARKS = ['ً', 'َ', 'ُ', 'ِ', 'ّ', 'ْ', 'ٰ', 'ـ'];

/**
 * Latin combining accents, inserted only where they sit on no letter: at the
 * start of a base, alone and doubled. After a letter they are an accent on it,
 * which the slash search ignores by design ("códe" finds Code block).
 */
export const LATIN_ACCENTS = ['̀', '́', '̈'];

/** Characters inserted at every position of every base. */
const EVERYWHERE = [...PUNCTUATION, ...INVISIBLE, ...ARABIC_MARKS];

interface DifferentialQuery {
  /** '' for a query of the inserted character alone or doubled. */
  base: string;
  char: string;
  position: number;
  query: string;
}

/** Each character inserted into each base (see above for where), then each character alone and doubled. */
export function* differentialQueries(bases: string[]): Generator<DifferentialQuery> {
  for (const base of bases) {
    for (const char of EVERYWHERE)
      for (let position = 0; position <= base.length; position += 1)
        yield { base, char, position, query: `${base.slice(0, position)}${char}${base.slice(position)}` };
    for (const char of LATIN_ACCENTS) yield { base, char, position: 0, query: `${char}${base}` };
  }
  for (const char of [...EVERYWHERE, ...LATIN_ACCENTS]) {
    yield { base: '', char, position: 0, query: char };
    yield { base: '', char, position: 1, query: `${char}${char}` };
  }
}
