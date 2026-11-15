import { projectConfigSchema } from '@nibleaf/validators';
import { describe, expect, it } from 'vitest';
import { addRow, removeRow, restoreRow, type VariablePair, variablesPatch, variablesValues } from './variables';

/**
 * The API's config merge (apps/server/src/actions/projects.ts `mergeConfig`):
 * an array replaces the stored one, an object merges one level deep.
 */
const mergeConfig = (existing: Record<string, unknown>, incoming: Record<string, unknown>) => {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    const previous = merged[key];
    merged[key] = Array.isArray(value)
      ? value
      : value && typeof value === 'object'
        ? { ...(previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}), ...value }
        : value;
  }
  return merged;
};

const pairs = (...list: Array<[string, string]>): VariablePair[] => list.map(([key, value]) => ({ key, value }));

describe('variablesValues', () => {
  it('reads no config, no list or a null list as no rows', () => {
    expect(variablesValues(undefined)).toEqual({ variables: [] });
    expect(variablesValues(null)).toEqual({ variables: [] });
    expect(variablesValues({})).toEqual({ variables: [] });
    expect(variablesValues({ variables: null })).toEqual({ variables: [] });
  });

  it('keeps stored order, text byte for byte, duplicate keys and empty values', () => {
    const stored = pairs([' product ', 'Acme\t'], ['version', ''], ['product', 'منتج'], ['ünïcode', '  ']);
    expect(variablesValues({ variables: stored })).toEqual({ variables: stored });
  });

  it('copies the pairs, so editing the draft never touches the query data', () => {
    const stored = pairs(['product', 'Acme']);
    const values = variablesValues({ variables: stored });
    expect(values.variables[0]).not.toBe(stored[0]);
  });
});

describe('variablesPatch', () => {
  it('leaves out rows whose key is empty or only whitespace, whatever their value', () => {
    expect(variablesPatch({ variables: pairs(['', ''], ['   ', 'orphan value'], ['\t', ''], ['product', 'Acme']) })).toEqual(
      pairs(['product', 'Acme']),
    );
  });

  it('sends every other row exactly as typed: spaces kept, duplicates and empty values kept, order kept', () => {
    const rows = pairs([' product ', ' Acme '], ['version', ''], [' product ', 'Second'], ['tagline', '  ']);
    expect(variablesPatch({ variables: rows })).toEqual(rows);
  });

  it('sends an empty list when nothing is left, so the stored list is cleared', () => {
    expect(variablesPatch({ variables: [] })).toEqual([]);
    expect(variablesPatch({ variables: pairs(['  ', 'x']) })).toEqual([]);
  });

  it('clearing the last saved row survives real JSON, the API schema, the merge and a refetch', () => {
    const stored = { theme: { preset: 'nib' }, redirects: [{ from: '/old', to: '/new' }], variables: pairs(['product', 'Acme']) };
    const draft = variablesValues(stored);
    const { rows } = removeRow(draft.variables, 0);
    const body = JSON.parse(JSON.stringify({ config: { variables: variablesPatch({ variables: rows }) } }));
    expect(body).toEqual({ config: { variables: [] } });
    const accepted = projectConfigSchema.parse(body.config);
    const refetched = JSON.parse(JSON.stringify(mergeConfig(stored, accepted)));
    expect(refetched).toEqual({ theme: { preset: 'nib' }, redirects: [{ from: '/old', to: '/new' }], variables: [] });
    expect(variablesValues(refetched)).toEqual({ variables: [] });
  });

  it('replaces the stored list as a whole: a removed middle row is gone, the rest keep their text and order', () => {
    const stored = { variables: pairs(['a', '1'], ['b', '2'], ['c', '3']) };
    const { rows } = removeRow(variablesValues(stored).variables, 1);
    const accepted = projectConfigSchema.parse(JSON.parse(JSON.stringify({ variables: variablesPatch({ variables: rows }) })));
    expect(variablesValues(mergeConfig(stored, accepted))).toEqual({ variables: pairs(['a', '1'], ['c', '3']) });
  });
});

describe('row operations', () => {
  const rows = pairs(['a', '1'], ['b', '2'], ['c', '3']);

  it('adds a blank row at the end without touching the others', () => {
    const next = addRow(rows);
    expect(next).toEqual([...rows, { key: '', value: '' }]);
    expect(rows).toHaveLength(3);
  });

  it('removes the middle row and hands it back', () => {
    expect(removeRow(rows, 1)).toEqual({ rows: pairs(['a', '1'], ['c', '3']), removed: { key: 'b', value: '2' } });
    expect(removeRow(rows, 5)).toEqual({ rows, removed: undefined });
  });

  it('restores a row where it was, keeping edits made to its neighbours since', () => {
    const { rows: left, removed } = removeRow(rows, 1);
    const edited = left.map((row) => (row.key === 'c' ? { ...row, value: '3 edited' } : row));
    expect(restoreRow(edited, 1, removed as VariablePair)).toEqual(pairs(['a', '1'], ['b', '2'], ['c', '3 edited']));
  });

  it('restores at the end when the list got shorter since', () => {
    expect(restoreRow(pairs(['a', '1']), 2, { key: 'c', value: '3' })).toEqual(pairs(['a', '1'], ['c', '3']));
  });
});
