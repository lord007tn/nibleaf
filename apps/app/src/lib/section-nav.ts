/**
 * Builds a settings navigation from its id list, in that order. `validateSearch`
 * keeps a bare id list so the router's eager chunk never loads the nav's icons;
 * typing the entries by those ids makes a missing or extra nav entry a type error,
 * so the two can never drift apart.
 */
export function navFromIds<Id extends string, Entry extends object>(ids: readonly Id[], entries: { readonly [K in Id]: Entry }) {
  return ids.map((id) => ({ id, ...entries[id] }));
}
