import { MAX_REDIRECT_RULES } from '@nibleaf/shared/redirects';
import { projectConfigSchema } from '@nibleaf/validators';
import { describe, expect, it } from 'vitest';
import {
  addRow,
  editRow,
  leftAfterRemove,
  leftAfterRestore,
  type RedirectRow,
  redirectProblems,
  redirectsPatch,
  redirectsValues,
  removeRow,
  restoreRow,
  sentRedirects,
} from './redirects';

const rule = (from: string, to: string, generated = false): RedirectRow => ({ from, to, generated });

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
/** A save as the API takes it: the patch through real JSON and the config schema, merged into what is stored, refetched. */
const saveThroughApi = (stored: Record<string, unknown>, redirects: RedirectRow[]) => {
  const body = JSON.parse(JSON.stringify({ config: { redirects: redirectsPatch({ redirects }) } }));
  const accepted = projectConfigSchema.parse(body.config);
  return { body, refetched: JSON.parse(JSON.stringify(mergeConfig(stored, accepted))) };
};

describe('redirectsValues', () => {
  it('reads the stored rules in order, text as stored, generated only when it is true', () => {
    const config = {
      redirects: [
        { from: ' /Über/ ', to: '/start?lang=ar#قسم', generated: true },
        { from: '/old', to: 'https://example.com/a?b=1#c' },
        { from: '/x', to: '/y', generated: false },
      ],
    };
    expect(redirectsValues(config)).toEqual({
      redirects: [rule(' /Über/ ', '/start?lang=ar#قسم', true), rule('/old', 'https://example.com/a?b=1#c'), rule('/x', '/y')],
    });
  });

  it('reads nothing stored as no rules', () => {
    expect(redirectsValues(undefined)).toEqual({ redirects: [] });
    expect(redirectsValues({ redirects: null })).toEqual({ redirects: [] });
  });
});

describe('redirectsPatch', () => {
  it('sends the authored rules in order with their flags, never the validator’s normalized single hops', () => {
    // a → b → c is a chain the validator flattens to a → c and b → c; the save keeps it as written.
    const redirects = [rule('/a/', '/b?x=1', true), rule('/b/', '/c#top'), rule('/%C3%BCber', 'HTTPS://Example.com/Path')];
    expect(redirectsPatch({ redirects })).toEqual(redirects);
    expect(redirectProblems(redirects)).toEqual([]);
  });

  it('leaves out rows with a blank source or destination and keeps every other row as typed', () => {
    const redirects = [rule('', ''), rule(' /a ', ' /b '), rule('  ', '\t'), rule('/c', '/d', true)];
    expect(redirectsPatch({ redirects })).toEqual([rule(' /a ', ' /b '), rule('/c', '/d', true)]);
    expect(sentRedirects({ redirects })).toEqual({ redirects: [rule(' /a ', ' /b '), rule('/c', '/d', true)] });
  });

  it('an empty draft, or one with only blank rows, sends [] and clears the stored rules', () => {
    expect(redirectsPatch({ redirects: [] })).toEqual([]);
    expect(redirectsPatch({ redirects: [rule('', '')] })).toEqual([]);
    expect(redirectProblems([rule('', '')])).toEqual([]);
  });
});

describe('a save through the API', () => {
  it('clearing the last rule sends [], and the refetch has no rules while other settings stay', () => {
    const stored = { theme: { preset: 'nib' }, variables: [{ key: 'product', value: 'Acme' }], redirects: [{ from: '/old', to: '/new', generated: true }] };
    const { rows } = removeRow(redirectsValues(stored).redirects, 0);
    expect(redirectProblems(rows)).toEqual([]);
    const { body, refetched } = saveThroughApi(stored, rows);
    expect(body).toEqual({ config: { redirects: [] } });
    expect(refetched).toEqual({ theme: { preset: 'nib' }, variables: [{ key: 'product', value: 'Acme' }], redirects: [] });
    expect(redirectsValues(refetched)).toEqual({ redirects: [] });
  });

  it('stores a chain, queries, fragments, Unicode and flags as authored, and reads them back the same', () => {
    const rows = [rule('/a/', '/b?x=1', true), rule('/b', '/c#top'), rule('/دليل', '/ar/guide?lang=ar'), rule('/old', 'https://example.com/x?y=1#z')];
    const { refetched } = saveThroughApi({ redirects: [] }, [...rows, rule('', '')]);
    expect(redirectsValues(refetched)).toEqual({ redirects: rows });
  });

  it('the API refuses what the draft refuses, so a refused draft is never one the API would take', () => {
    for (const rows of [[rule('/a', '')], [rule('/a', '/b'), rule('/a', '/c')], [rule('/a', '/b'), rule('/b', '/a')]]) {
      expect(redirectProblems(rows).length).toBeGreaterThan(0);
      expect(projectConfigSchema.safeParse({ redirects: rows }).success).toBe(false);
    }
  });
});

describe('row edits', () => {
  const rows = [rule('/a', '/b', true), rule('/c', '/d', true), rule('/e', '/f')];

  it('editing the source or the destination makes that row the writer’s; other rows keep their flag', () => {
    expect(editRow(rows, 1, 'from', '/c2')).toEqual([rule('/a', '/b', true), rule('/c2', '/d'), rule('/e', '/f')]);
    expect(editRow(rows, 0, 'to', '/b2')).toEqual([rule('/a', '/b2'), rule('/c', '/d', true), rule('/e', '/f')]);
  });

  it('adds a blank row at the end', () => {
    expect(addRow(rows)).toEqual([...rows, rule('', '')]);
  });

  it('removes a middle row and restores it, flag included, keeping later edits to its neighbours', () => {
    const { rows: rest, removed } = removeRow(rows, 1);
    expect(rest).toEqual([rows[0], rows[2]]);
    expect(removed).toEqual(rule('/c', '/d', true));
    const edited = editRow(rest, 1, 'to', '/f2');
    expect(restoreRow(edited, 1, removed as RedirectRow)).toEqual([rule('/a', '/b', true), rule('/c', '/d', true), rule('/e', '/f2')]);
  });

  it('restores at the end when the list got shorter, and removes nothing past the end', () => {
    expect(restoreRow([], 2, rule('/x', '/y'))).toEqual([rule('/x', '/y')]);
    expect(removeRow(rows, 5)).toEqual({ rows, removed: undefined });
  });

  it('moves the rows that were left along with the rows', () => {
    expect([...leftAfterRemove(new Set([0, 1, 3]), 1)]).toEqual([0, 2]);
    expect([...leftAfterRestore(new Set([0, 2]), 1)]).toEqual([0, 3]);
  });
});

describe('redirectProblems', () => {
  it('refuses a half-filled row on the field that is missing, and ignores fully blank rows', () => {
    expect(redirectProblems([rule('/a', ''), rule('', ''), rule('', '/b')])).toEqual([
      { message: 'A redirect must have both a source and a destination.', rows: [0], fields: ['to'] },
      { message: 'A redirect must have both a source and a destination.', rows: [2], fields: ['from'] },
    ]);
  });

  it('names both rows of a duplicate source and every row of a cycle', () => {
    expect(redirectProblems([rule('/a', '/b'), rule('/a/', '/c')])).toEqual([
      { message: 'Conflicting redirect source /a (rows 1 and 2).', rows: [0, 1], fields: ['from'] },
    ]);
    expect(redirectProblems([rule('/a', '/b'), rule('/b', '/a')])).toEqual([
      { message: 'Redirect cycle detected: /a -> /b -> /a.', rows: [0, 1], fields: ['to'] },
    ]);
  });

  it('refuses malformed sources and destinations, self-redirects and over-long chains', () => {
    const codes = (rows: RedirectRow[]) => redirectProblems(rows).map(({ rows: at, fields }) => ({ rows: at, fields }));
    expect(codes([rule('/a?x', '/b')])).toEqual([{ rows: [0], fields: ['from'] }]);
    expect(codes([rule('/a', 'javascript:alert(1)')])).toEqual([{ rows: [0], fields: ['to'] }]);
    expect(codes([rule('/a', '//evil.example')])).toEqual([{ rows: [0], fields: ['to'] }]);
    expect(codes([rule('/a', '/a#top')])).toEqual([{ rows: [0], fields: ['to'] }]);
    const chain = Array.from({ length: 12 }, (_, index) => rule(`/p${index}`, `/p${index + 1}`));
    expect(redirectProblems(chain).length).toBeGreaterThan(0);
    expect(redirectProblems(chain).every((problem) => problem.fields[0] === 'to' && problem.rows.length > 0)).toBe(true);
  });

  it('points "too many rules" at the rows past the limit, so it can be fixed', () => {
    const atLimit = Array.from({ length: MAX_REDIRECT_RULES }, (_, index) => rule(`/old-${index}`, '/current'));
    expect(redirectProblems(atLimit)).toEqual([]);
    const over = [...atLimit, rule('', '')];
    expect(redirectProblems(over)).toEqual([
      {
        message: `Redirect configuration has ${MAX_REDIRECT_RULES + 1} rules; the limit is ${MAX_REDIRECT_RULES}.`,
        rows: [MAX_REDIRECT_RULES],
        fields: ['from', 'to'],
      },
    ]);
  });
});
