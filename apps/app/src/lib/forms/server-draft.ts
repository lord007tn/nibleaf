/**
 * The form lifecycle of operations/ui-overhaul.md §8.3, as pure functions.
 *
 * A form edits normalized values (`toValues(serverData)`), never the raw query
 * object, and keeps three of them:
 * - `baseline`: what the server last confirmed for this identity;
 * - `submitted`: what an in-flight save sent;
 * - `current`: the form's state.
 *
 * Some forms send a transformed payload (`toSent`: rows without a key dropped,
 * strings trimmed), so the server stores and echoes values the form never
 * held. A save is then judged in sent space: what it sent, and the baseline
 * passed through `toSent`. The form itself always keeps the raw values.
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
 * - `values`: what it sent (`toSent` of the form's values, when given);
 * - `raw`: the form's values it was sent from;
 * - `toSent`: the transform, when the form sends a transformed payload;
 * - `sent`: the keys it changed from the baseline at that moment, compared in
 *   sent space, so a change `toSent` drops (a row without a key, trailing
 *   spaces) is not awaited as an echo that never comes;
 * - `echoed`: the sent keys a refetch has since returned with the sent value.
 *   A key joins once and never leaves for the rest of the save.
 */
export type PendingSave<T extends DraftValues> = {
  values: T;
  raw: T;
  toSent?: (values: T) => T;
  sent: ReadonlySet<string>;
  echoed: ReadonlySet<string>;
};

export const startSave = <T extends DraftValues>(baseline: T, raw: T, toSent?: (values: T) => T): PendingSave<T> => {
  const values = toSent ? toSent(raw) : raw;
  return { values, raw, toSent, sent: new Set(editedKeys(values, toSent ? toSent(baseline) : baseline)), echoed: new Set() };
};

/** A sent key the server hasn't echoed yet: the form holds the person's pending value for it. */
const awaitingEcho = <T extends DraftValues>(save: PendingSave<T>, key: string) => save.sent.has(key) && !save.echoed.has(key);

/** Server values as a transforming save would send them, so they compare with what it sent. */
const inSentSpace = <T extends DraftValues>(save: PendingSave<T> | undefined, values: T) => (save?.toSent ? save.toSent(values) : values);

/**
 * During a transforming save, a key the person hasn't changed since is judged
 * by what the save sent for it. Never true without `toSent`.
 */
const untouched = <T extends DraftValues>(save: PendingSave<T> | undefined, current: T, key: string): save is PendingSave<T> =>
  Boolean(save?.toSent) && deepEqual(current[key], save?.raw[key]);

/**
 * Whether the form's value for a key agrees with `server`'s: compared in sent
 * space for a key left untouched during a transforming save, else as is.
 */
export function agreesWith<T extends DraftValues>(current: T, server: T, save?: PendingSave<T>) {
  const serverSent = inSentSpace(save, server);
  return (key: string) => (untouched(save, current, key) ? deepEqual(save.values[key], serverSent[key]) : deepEqual(current[key], server[key]));
}

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
 *
 * A transforming save (`toSent`) compares server values in sent space, so the
 * server normalizing a value is no change. Once echoed, a key the person
 * hasn't changed since the save is judged by what was sent for it, and keeps
 * its raw value until the server changes it. A key the save sent nothing new
 * for is judged by its raw value, so content `toSent` drops is never lost.
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
  const baselineSent = inSentSpace(save, baseline);
  const nextSent = inSentSpace(save, next);
  const agreesWithBaseline = agreesWith(current, baseline, save);
  const agreesWithNext = agreesWith(current, next, save);
  for (const key of keysOf(baseline, current, next)) {
    const serverChanged = !deepEqual(nextSent[key], baselineSent[key]);
    if (save && awaitingEcho(save, key)) {
      if (deepEqual(nextSent[key], save.values[key])) echoed.add(key);
      else if (serverChanged && !agreesWithNext(key)) conflicts.push(key as keyof T & string);
      continue;
    }
    const wasEchoed = Boolean(save?.echoed.has(key));
    const edited = wasEchoed ? !agreesWithBaseline(key) : !deepEqual(current[key], baseline[key]);
    if (!edited) merged[key] = wasEchoed && !serverChanged && untouched(save, current, key) ? current[key] : next[key];
    else if (serverChanged && !agreesWithNext(key)) conflicts.push(key as keyof T & string);
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
 *
 * During a transforming save, a key the person hasn't changed since is judged
 * in sent space by what the save sent for it, and is also confirmed when that
 * agrees with the new baseline: a value `toSent` normalized is confirmed,
 * never kept as an edit.
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
  const reachedSent = during && inSentSpace(during.save, during.baseline);
  const agreesWithNew = agreesWith(current, baseline, during?.save);
  const edited = (key: string) => {
    if (!untouched(during?.save, current, key)) return !deepEqual(current[key], reference(key));
    const sentSpaceReference = awaiting(key) ? submitted[key] : reachedSent?.[key];
    return !deepEqual(during?.save.values[key], sentSpaceReference) && !agreesWithNew(key);
  };
  const next: DraftValues = { ...baseline };
  for (const key of keys) {
    if (edited(key)) next[key] = current[key];
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
