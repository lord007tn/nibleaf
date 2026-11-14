import { describe, expect, it } from 'vitest';
import main from './__fixtures__/slash-no-match-main.json';
import { createSlashItems, rankSlashItems } from './extensions/slash-command';
import { slashQueryCharactersKnown } from './extensions/slash-search';
import { differentialQueries, PUNCTUATION } from './slash-differential-queries';

/*
 * Apart from words separated by spaces, the slash menu never matches a query
 * that main's matcher matched to nothing: punctuation is matched literally, not
 * treated as a word break, so "/?", "/code\block" or "/(code)" stay text.
 *
 * `__fixtures__/slash-no-match-main.json` was made by running main's own slash
 * matcher (main 78d54279) over the single-word queries in
 * slash-differential-queries.ts: every block name and main keyword with one
 * ASCII or Arabic punctuation character in each position, plus each character
 * alone and doubled (47,683 queries; main matched 47,644 of them to nothing).
 */

type Fixture = {
  punctuation: string[];
  bases: string[];
  queries: number;
  noMatchCount: number;
  noMatch: Record<string, Record<string, number[] | '*'>>;
  alone: string[];
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

describe('slash differential against main', () => {
  it('reads the same queries main was run on', () => {
    expect(PUNCTUATION).toEqual(fixture.punctuation);
    expect(fixture.queries).toBeGreaterThanOrEqual(2000);
    expect(mainNoMatch()).toHaveLength(fixture.noMatchCount);
  });

  it('matches nothing, and keeps the menu closed, for every query main matched to nothing', () => {
    const matched: string[] = [];
    const open: string[] = [];
    for (const query of mainNoMatch()) {
      if (rankSlashItems(items, query).length > 0) matched.push(query);
      // Only plain words (and "-") keep the menu open; they then show "No blocks found".
      if (slashQueryCharactersKnown(query, items) && !/^[\p{L}\p{N}-]+$/u.test(query)) open.push(query);
    }
    expect(matched).toEqual([]);
    expect(open).toEqual([]);
  }, 120_000);
});
