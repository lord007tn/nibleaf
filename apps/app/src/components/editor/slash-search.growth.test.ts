import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { createSlashItems, rankSlashItems } from './extensions/slash-command';
import type { SlashItem } from './extensions/slash-items/types';
import { slashQueryCouldMatch } from './extensions/slash-search';

/** `copies` copies of the 50 menu items, as distinct objects. */
const menuOf = (copies: number): SlashItem[] => Array.from({ length: copies }, () => createSlashItems().map((item) => ({ ...item }))).flat();

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
describe.runIf(growthTestsEnabled)('slash search growth', () => {
  it('searches 4x the items in about 4x the time', () => {
    const small = menuOf(20);
    const large = menuOf(80);
    // Each copy holds exactly one Code block.
    expect(rankSlashItems(small, 'code block')).toHaveLength(20);
    expect(rankSlashItems(large, 'code block')).toHaveLength(80);
    const [smallMs, largeMs] = growthMs((items: SlashItem[]) => rankSlashItems(items, 'code block'), small, large);
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
  });

  it('rejects a long query of alternating combining marks without normalizing it', () => {
    // U+0300 and U+0315 have different combining classes, so NFD reorders the
    // whole run; a query this long is past any block name and is rejected first.
    const pair = String.fromCodePoint(0x03_00, 0x03_15);
    const small = `code${pair.repeat(4000)}`;
    const large = `code${pair.repeat(16_000)}`;
    const items = createSlashItems();
    const run = (query: string) => [rankSlashItems(items, query).length, slashQueryCouldMatch(query, items)];
    const [smallMs, largeMs] = growthMs(run, small, large);
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
    // Past any block name: no matches, and not a command.
    expect(run(large)).toEqual([0, false]);
  });
});
