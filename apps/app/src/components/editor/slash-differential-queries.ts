/**
 * Queries for the slash differential guard (slash-differential.test.ts): single
 * words, no spaces, built from block names and keywords with punctuation in
 * every position. The bases (main's block names and keywords, lower-cased,
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

interface DifferentialQuery {
  /** '' for a punctuation-only query. */
  base: string;
  char: string;
  position: number;
  query: string;
}

/** `char` inserted at each position of each base, then each character alone and doubled. */
export function* differentialQueries(bases: string[]): Generator<DifferentialQuery> {
  for (const base of bases)
    for (const char of PUNCTUATION)
      for (let position = 0; position <= base.length; position += 1)
        yield { base, char, position, query: `${base.slice(0, position)}${char}${base.slice(position)}` };
  for (const char of PUNCTUATION) {
    yield { base: '', char, position: 0, query: char };
    yield { base: '', char, position: 1, query: `${char}${char}` };
  }
}
