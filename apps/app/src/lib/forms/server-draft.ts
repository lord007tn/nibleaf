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

/**
 * A save in flight, fixed when its request is sent:
 * - `values`: what it sent;
 * - `sent`: the keys it changed from the baseline at that moment;
 * - `echoed`: the sent keys a refetch has since returned with the sent value.
 *   A key joins once and never leaves for the rest of the save.
 */
export type PendingSave<T extends DraftValues> = {
  values: T;
  sent: ReadonlySet<string>;
  echoed: ReadonlySet<string>;
};

export const startSave = <T extends DraftValues>(baseline: T, values: T): PendingSave<T> => ({
  values,
  sent: new Set(editedKeys(values, baseline)),
  echoed: new Set(),
});

/** A sent key the server hasn't echoed yet: the form holds the person's pending value for it. */
const awaitingEcho = <T extends DraftValues>(save: PendingSave<T>, key: string) => save.sent.has(key) && !save.echoed.has(key);

export type ServerChange<T extends DraftValues> = {
  /** The new baseline: always the server's values. */
  baseline: T;
  /** What the form should now hold. */
  current: T;
  /** Keys the person edited that the server also changed, to a different value. Their edits are kept. */
  conflicts: Array<keyof T & string>;
  /** The save in flight, with the keys this change echoed added. */
  save?: PendingSave<T>;
};

/**
 * Rule 2: the server's values changed (a refetch, someone else's save).
 * - Keys the person hasn't edited take the server's value.
 * - Keys the person edited and the server left alone keep the edit.
 * - Keys both changed keep the edit and are reported as conflicts, unless
 *   both landed on the same value.
 *
 * During a save, pass it as `save`. A sent key awaiting its echo holds the
 * person's pending value: it counts as edited even if they typed it back
 * since, and the server returning the sent value is the echo, never a
 * conflict. Once echoed, the key follows the rules above against the
 * baseline, which the echo set to the sent value and later changes move on.
 */
export function reconcileServerChange<T extends DraftValues>({
  baseline,
  current,
  next,
  save,
}: {
  baseline: T;
  current: T;
  next: T;
  save?: PendingSave<T>;
}): ServerChange<T> {
  const merged: DraftValues = { ...current };
  const conflicts: Array<keyof T & string> = [];
  const echoed = new Set(save?.echoed);
  for (const key of keysOf(baseline, current, next)) {
    const serverChanged = !deepEqual(next[key], baseline[key]);
    if (save && awaitingEcho(save, key)) {
      if (deepEqual(next[key], save.values[key])) echoed.add(key);
      else if (serverChanged && !deepEqual(current[key], next[key])) conflicts.push(key as keyof T & string);
      continue;
    }
    const edited = !deepEqual(current[key], baseline[key]);
    if (!edited) merged[key] = next[key];
    else if (serverChanged && !deepEqual(current[key], next[key])) conflicts.push(key as keyof T & string);
  }
  return { baseline: next, current: merged as T, conflicts, save: save && { ...save, echoed } };
}

/**
 * Rule 3: a save succeeded. The baseline becomes what the server confirmed:
 * the response's values when it returned the entity (server normalization
 * wins), else what was sent. Keys the person edited keep the edit and stay
 * dirty: without `during`, any key that differs from `submitted`.
 *
 * With `during` (the save's state and the baseline it reached through
 * refetches), keys are judged by rule 2's classification: a key awaiting its
 * echo is edited if it differs from what was sent; any other key if it
 * differs from that baseline, so values the form took from the server are
 * not edits. Without a response, those keys confirm that baseline.
 */
export function reconcileSaveSuccess<T extends DraftValues>({
  submitted,
  current,
  confirmed,
  during,
}: {
  submitted: T;
  current: T;
  confirmed?: T;
  during?: { save: PendingSave<T>; baseline: T };
}): { baseline: T; current: T } {
  const awaiting = (key: string) => !during || awaitingEcho(during.save, key);
  const reference = (key: string) => (awaiting(key) ? submitted[key] : during?.baseline[key]);
  const keys = keysOf(submitted, current, ...(during ? [during.baseline] : []));
  const baseline = confirmed ?? (during ? (Object.fromEntries(keys.map((key) => [key, reference(key)])) as T) : submitted);
  const next: DraftValues = { ...baseline };
  for (const key of keys) {
    if (!deepEqual(current[key], reference(key))) next[key] = current[key];
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
