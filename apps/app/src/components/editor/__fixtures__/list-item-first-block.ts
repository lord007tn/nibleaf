import fixture from './list-item-first-block-main.json';

export interface ListItemRepair {
  main: string;
  patches: Array<{ at: number; remove: string; insert: string }>;
  mainFixed: boolean;
}

export const LIST_ITEM_FIRST_BLOCK_CASES = fixture.cases;
export const LIST_ITEM_FIRST_BLOCK_INDICES = fixture.cases.map(({ index }) => index);
export const LIST_ITEM_MAIN_TOGGLE_OVERLAP = fixture.mainToggleOverlap;

/** Apply the named prefix repair to pinned main bytes; all other bytes survive. */
export function repairedListItem(repair: ListItemRepair): string {
  const characters = Array.from(repair.main);
  for (const patch of [...repair.patches].reverse()) {
    const removed = Array.from(patch.remove);
    if (characters.slice(patch.at, patch.at + removed.length).join('') !== patch.remove)
      throw new Error('List repair does not match pinned main bytes');
    if (!/^[\s>]*$/.test(patch.remove + patch.insert)) throw new Error('A list repair changed content');
    characters.splice(patch.at, removed.length, ...Array.from(patch.insert));
  }
  return characters.join('');
}
