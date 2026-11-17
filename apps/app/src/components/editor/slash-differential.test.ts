import { describe, expect, it } from 'vitest';
import main from './__fixtures__/slash-no-match-main.json';
import { createSlashItems, rankSlashItems } from './extensions/slash-command';
import { slashQueryCouldMatch } from './extensions/slash-search';
import {
  ARABIC_MARKS,
  DEFAULT_IGNORABLE,
  DEFAULT_IGNORABLE_BASES,
  DEFAULT_IGNORABLE_SAMPLE,
  defaultIgnorableQueries,
  differentialQueries,
  INVISIBLE,
  LATIN_ACCENTS,
  PUNCTUATION,
} from './slash-differential-queries';

/*
 * Apart from words separated by plain spaces, and accents sitting on letters,
 * the slash menu never matches a query that main's matcher matched to nothing:
 * punctuation is matched literally, other whitespace never separates words, a
 * mark that sits on no letter is kept rather than folded away, and
 * default-ignorable code points are never folded at all. So "/?",
 * "/code\block", "/(code)", "/code" + a no-break space + "block", a word made
 * only of marks or tatweel, or "co" + a combining grapheme joiner + "de" stay
 * text.
 *
 * `__fixtures__/slash-no-match-main.json` was made by running main's own slash
 * matcher (main 78d54279) over the single-word queries in
 * slash-differential-queries.ts:
 * - every block name and main keyword with one character inserted (ASCII and
 *   Arabic punctuation, whitespace other than a plain space, zero-width and
 *   direction marks, Arabic marks and tatweel, and a sample of 28
 *   default-ignorables at each position; Latin accents at the start), plus each
 *   character alone and doubled;
 * - every Default_Ignorable_Code_Point (4,174) at every position of "code",
 *   "note" and "h1", including after letters.
 */

type Fixture = {
  characters: {
    punctuation: string[];
    invisible: string[];
    arabicMarks: string[];
    latinAccents: string[];
    defaultIgnorableSample: string[];
  };
  bases: string[];
  queries: number;
  noMatchCount: number;
  noMatch: Record<string, Record<string, number[] | '*'>>;
  alone: string[];
  defaultIgnorable: { bases: string[]; codePoints: number; queries: number; noMatchCount: number; matched: string[] };
};
const fixture = main as Fixture;
const items = createSlashItems();

/** The queries main matched to nothing, decoded from the fixture. */
const mainNoMatch = (): string[] => {
  const alone = new Set(fixture.alone);
  const found: string[] = [];
  let generated = 0;
  for (const { base, char, position, query } of differentialQueries(fixture.bases)) {
    generated += 1;
    const positions = base === '' ? null : fixture.noMatch[base]?.[char];
    if (base === '' ? alone.has(query) : positions === '*' || positions?.includes(position)) found.push(query);
  }
  expect(generated).toBe(fixture.queries);
  return found;
};

/** The default-ignorable queries main matched to nothing: all of them except the few the fixture lists as matched. */
const mainDefaultIgnorableNoMatch = (): string[] => {
  const matched = new Set(fixture.defaultIgnorable.matched);
  const found: string[] = [];
  let generated = 0;
  for (const { query } of defaultIgnorableQueries()) {
    generated += 1;
    if (!matched.has(query)) found.push(query);
  }
  expect(generated).toBe(fixture.defaultIgnorable.queries);
  return found;
};

describe('slash differential against main', () => {
  it('reads the same queries main was run on', () => {
    expect(fixture.characters).toEqual({
      punctuation: PUNCTUATION,
      invisible: INVISIBLE,
      arabicMarks: ARABIC_MARKS,
      latinAccents: LATIN_ACCENTS,
      defaultIgnorableSample: DEFAULT_IGNORABLE_SAMPLE,
    });
    expect(fixture.queries).toBeGreaterThanOrEqual(2000);
    expect(mainNoMatch()).toHaveLength(fixture.noMatchCount);
    expect(fixture.defaultIgnorable.bases).toEqual(DEFAULT_IGNORABLE_BASES);
    expect(fixture.defaultIgnorable.codePoints).toBe(DEFAULT_IGNORABLE.length);
    expect(DEFAULT_IGNORABLE_SAMPLE.every((char) => DEFAULT_IGNORABLE.includes(char))).toBe(true);
    expect(mainDefaultIgnorableNoMatch()).toHaveLength(fixture.defaultIgnorable.noMatchCount);
  });

  it('matches nothing, and keeps the menu closed, for every query main matched to nothing', () => {
    const matched: string[] = [];
    const open: string[] = [];
    for (const query of mainNoMatch()) {
      if (rankSlashItems(items, query).length > 0) matched.push(query);
      // Only plain words (and "-") keep the menu open; they then show "No blocks found".
      if (slashQueryCouldMatch(query, items) && !/^[\p{L}\p{N}-]+$/u.test(query)) open.push(query);
    }
    expect(matched).toEqual([]);
    expect(open).toEqual([]);
  }, 120_000);

  it('never folds a default-ignorable code point: every one, at every position of "code", "note" and "h1", matches nothing', () => {
    const matched: string[] = [];
    const open: string[] = [];
    for (const query of mainDefaultIgnorableNoMatch()) {
      if (rankSlashItems(items, query).length > 0) matched.push(query);
      if (slashQueryCouldMatch(query, items)) open.push(query);
    }
    const codePoints = (query: string) => [...query].map((char) => `U+${(char.codePointAt(0) ?? 0).toString(16)}`).join(' ');
    expect(matched.map(codePoints)).toEqual([]);
    expect(open.map(codePoints)).toEqual([]);
  }, 120_000);
});
