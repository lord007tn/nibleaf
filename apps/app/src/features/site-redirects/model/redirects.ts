import { MAX_REDIRECT_RULES, validateRedirectGraph } from '@nibleaf/shared/redirects';

/**
 * Site redirects as a draft: the ordered rules the published site answers
 * with. The whole list is one value, saved as one `config.redirects` array
 * that replaces the stored one.
 *
 * The rules are kept as authored. The graph validator normalizes and
 * flattens chains for the reader; the draft uses it only to accept or refuse
 * the rules and to say what is wrong, never to rewrite them.
 */

/** One rule. `generated` marks a rule the editor added when a page moved; an edit makes it the writer's own. */
export type RedirectRow = { from: string; to: string; generated: boolean };

/** The editable values: one array, so a refetch keeps or replaces it as a whole. */
export type RedirectsValues = { redirects: RedirectRow[] };

export type RedirectField = 'from' | 'to';

type StoredRedirect = { from: string; to: string; generated?: boolean };

/** The editable values for a project config: the stored rules, in stored order, text as stored. */
export const redirectsValues = (config: { redirects?: ReadonlyArray<StoredRedirect> | null } | null | undefined): RedirectsValues => ({
  redirects: (config?.redirects ?? []).map(({ from, to, generated }) => ({ from, to, generated: generated === true })),
});

const isBlank = (text: string) => text.trim() === '';

/**
 * The `config.redirects` a save sends: the whole list, so an empty draft
 * sends `[]` and clears every stored rule.
 *
 * A row with a blank source or destination is left out. A save only goes out
 * when `redirectProblems` finds nothing, and that refuses a half-filled row,
 * so in practice only fully blank rows are dropped. Every other row is sent as
 * typed (paths, queries, fragments, external URLs untouched), in order, with
 * its `generated` flag.
 */
export const redirectsPatch = ({ redirects }: RedirectsValues): RedirectRow[] =>
  redirects.filter((row) => !isBlank(row.from) && !isBlank(row.to)).map(({ from, to, generated }) => ({ from, to, generated }));

/** What a save sends for the draft, as draft values: the rows `redirectsPatch` keeps. */
export const sentRedirects = (values: RedirectsValues): RedirectsValues => ({ redirects: redirectsPatch(values) });

/** A new blank row at the end. A blank row is ignored by validation and left out of a save. */
export const addRow = (rows: readonly RedirectRow[]): RedirectRow[] => [...rows, { from: '', to: '', generated: false }];

/** Sets one field of one row. Editing a rule makes it the writer's: its `generated` flag is cleared. */
export const editRow = (rows: readonly RedirectRow[], index: number, field: RedirectField, text: string): RedirectRow[] =>
  rows.map((row, position) => (position === index ? { ...row, [field]: text, generated: false } : row));

/** The rows without the one at `index`, and that row (with its `generated` flag), to offer it back. */
export const removeRow = (rows: readonly RedirectRow[], index: number) => ({
  rows: rows.filter((_, position) => position !== index),
  removed: rows[index],
});

/** Puts a removed row back at `index` (or at the end, if the list got shorter), keeping every other row as it is now. */
export const restoreRow = (rows: readonly RedirectRow[], index: number, row: RedirectRow): RedirectRow[] => [
  ...rows.slice(0, index),
  row,
  ...rows.slice(index),
];

/** One thing the validator refuses, located in the draft. */
export type RedirectProblem = {
  /** The validator's message, unchanged. */
  message: string;
  /** The draft rows to fix, in order. */
  rows: number[];
  /** Which of their fields to mark. */
  fields: RedirectField[];
};

/**
 * What stops the draft from saving, from the shared graph validator (the same
 * one the API runs): half-filled rows, malformed paths and URLs, duplicate
 * sources, self-redirects, cycles, over-long chains, and too many rules.
 *
 * Each problem points at the rows that fix it. "Too many rules" names no row,
 * so it points at the rows past the limit.
 */
export function redirectProblems(rows: readonly RedirectRow[]): RedirectProblem[] {
  return validateRedirectGraph(rows).issues.map((issue) => ({
    message: issue.message,
    rows: issue.rowIndexes.length > 0 || issue.code !== 'too-many-rules' ? issue.rowIndexes : rows.map((_, index) => index).slice(MAX_REDIRECT_RULES),
    fields: issue.field ? [issue.field] : ['from', 'to'],
  }));
}

/**
 * The rows whose problems the person has been shown, as positions. A row's
 * problems show once one of its fields was left (or the form was submitted),
 * as `FormField` does for a single field. Positions follow the rows: removing
 * a row shifts the ones after it back, restoring one shifts them forward.
 */
export const leftAfterRemove = (left: ReadonlySet<number>, index: number): Set<number> =>
  new Set([...left].filter((row) => row !== index).map((row) => (row > index ? row - 1 : row)));

export const leftAfterRestore = (left: ReadonlySet<number>, index: number): Set<number> =>
  new Set([...left].map((row) => (row >= index ? row + 1 : row)));
