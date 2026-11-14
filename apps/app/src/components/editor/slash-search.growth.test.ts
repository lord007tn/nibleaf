import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { createSlashItems, rankSlashItems } from './extensions/slash-command';
import type { SlashItem } from './extensions/slash-items/types';

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
});
