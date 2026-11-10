/**
 * The form lifecycle of operations/ui-overhaul.md §8.3, as pure functions.
 *
 * A form edits normalized values (`toValues(serverData)`), never the raw query
 * object, and keeps three of them:
 * - `baseline`: what the server last confirmed for this identity;
 * - `submitted`: what an in-flight save sent;
 * - `current`: the form's state.
 *
 * Values are compared per top-level key, each key compared deeply. That is the
 * granularity at which edits are kept or replaced.
 */

export type DraftValues = Record<string, unknown>;

/** Structural equality for plain JSON-like values (objects, arrays, primitives). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.hasOwn(b as object, key) && deepEqual((a as DraftValues)[key], (b as DraftValues)[key]));
}

const keysOf = (...values: DraftValues[]) => [...new Set(values.flatMap((value) => Object.keys(value)))];

/** Rule 1: the only definition of dirty. */
export const isDraftDirty = <T extends DraftValues>(current: T, baseline: T) => !deepEqual(current, baseline);

/** The keys the person has changed from the baseline. */
export const editedKeys = <T extends DraftValues>(current: T, baseline: T) =>
  keysOf(current, baseline).filter((key) => !deepEqual(current[key], baseline[key])) as Array<keyof T & string>;

export type ServerChange<T extends DraftValues> = {
  /** The new baseline: always the server's values. */
  baseline: T;
  /** What the form should now hold. */
  current: T;
  /** Keys the person edited that the server also changed, to a different value. Their edits are kept. */
  conflicts: Array<keyof T & string>;
};

/**
 * Rule 2: the server's values changed (a refetch, someone else's save).
 * - Keys the person hasn't edited take the server's value.
 * - Keys the person edited and the server left alone keep the edit.
 * - Keys both changed keep the edit and are reported as conflicts, unless
 *   both landed on the same value.
 */
export function reconcileServerChange<T extends DraftValues>({ baseline, current, next }: { baseline: T; current: T; next: T }): ServerChange<T> {
  const merged: DraftValues = { ...current };
  const conflicts: Array<keyof T & string> = [];
  for (const key of keysOf(baseline, current, next)) {
    const edited = !deepEqual(current[key], baseline[key]);
    const serverChanged = !deepEqual(next[key], baseline[key]);
    if (!edited) merged[key] = next[key];
    else if (serverChanged && !deepEqual(current[key], next[key])) conflicts.push(key as keyof T & string);
  }
  return { baseline: next, current: merged as T, conflicts };
}

/**
 * Rule 3: a save succeeded. The baseline becomes what the server confirmed:
 * the response's values when it returned the entity (server normalization
 * wins), else what was sent. Keys edited while the request was in flight
 * (`current` differs from `submitted`) keep the newer edit and stay dirty.
 */
export function reconcileSaveSuccess<T extends DraftValues>({
  submitted,
  current,
  confirmed,
}: {
  submitted: T;
  current: T;
  confirmed?: T;
}): { baseline: T; current: T } {
  const baseline = confirmed ?? submitted;
  const next: DraftValues = { ...baseline };
  for (const key of keysOf(submitted, current)) {
    if (!deepEqual(current[key], submitted[key])) next[key] = current[key];
  }
  return { baseline, current: next as T };
}

/** Resolves a conflict: "theirs" takes the server value, "mine" keeps the edit. */
export function resolveConflict<T extends DraftValues>({
  baseline,
  current,
  key,
  choice,
}: {
  baseline: T;
  current: T;
  key: keyof T & string;
  choice: 'theirs' | 'mine';
}): T {
  return choice === 'theirs' ? ({ ...current, [key]: baseline[key] } as T) : current;
}
