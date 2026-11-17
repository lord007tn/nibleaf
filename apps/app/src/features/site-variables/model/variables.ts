/**
 * Site variables as a draft: the ordered `{ key, value }` pairs a page reads
 * as `{{ var.<key> }}`. The whole list is one value, saved as one
 * `config.variables` array that replaces the stored one.
 */

/** One stored pair. Text is kept exactly as typed: never trimmed, renamed or de-duplicated. */
export type VariablePair = { key: string; value: string };

/** The editable values: one array, so a refetch keeps or replaces it as a whole. */
export type VariablesValues = { variables: VariablePair[] };

/** The editable values for a project config: the stored pairs, in stored order, byte for byte. */
export const variablesValues = (config: { variables?: ReadonlyArray<VariablePair> | null } | null | undefined): VariablesValues => ({
  variables: (config?.variables ?? []).map(({ key, value }) => ({ key, value })),
});

/**
 * The `config.variables` a save sends: the whole list, so an empty draft
 * sends `[]` and clears every stored pair.
 *
 * A row whose key is empty or only whitespace is left out: a page can't
 * reference it, so it is never stored. Every other row is sent exactly as
 * typed, in order, duplicate keys and empty values included.
 */
export const variablesPatch = ({ variables }: VariablesValues): VariablePair[] =>
  variables.filter((pair) => pair.key.trim() !== '').map(({ key, value }) => ({ key, value }));

/** A new blank row at the end. */
export const addRow = (rows: readonly VariablePair[]): VariablePair[] => [...rows, { key: '', value: '' }];

/** The rows without the one at `index`, and that row, to offer it back. */
export const removeRow = (rows: readonly VariablePair[], index: number) => ({
  rows: rows.filter((_, position) => position !== index),
  removed: rows[index],
});

/** Puts a removed row back at `index` (or at the end, if the list got shorter), keeping every other row as it is now. */
export const restoreRow = (rows: readonly VariablePair[], index: number, row: VariablePair): VariablePair[] => [
  ...rows.slice(0, index),
  row,
  ...rows.slice(index),
];
