import { useForm, useStore } from '@tanstack/react-form';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  agreesWith,
  type DraftValues,
  deepEqual,
  isDraftDirty,
  type PendingSave,
  reconcileSaveSuccess,
  reconcileServerChange,
  resolveConflict as resolveConflictValues,
  startSave,
} from './server-draft';

/** What a submit handler gets besides the values, to report how its save went. */
export type DraftSave<T extends DraftValues> = {
  /** The baseline the save is relative to (what the server last confirmed when it started). */
  baseline: T;
  /**
   * Call after the server confirmed. Pass its normalized values when it
   * returned them: this request's own response, never a snapshot read from the
   * query cache. Server data reaches the form only through `source`, where it is
   * reconciled for edits and conflicts.
   */
  succeeded: (confirmed?: T) => void;
  /** Call after a failed save: nothing is confirmed and the edits stay. */
  failed: () => void;
  /**
   * False once this save no longer belongs to the form: it moved to another
   * identity (or away and back) since the save started. `succeeded` and
   * `failed` then do nothing; check it before touching the form yourself
   * (e.g. mapping a field error).
   */
  isCurrent: () => boolean;
};

/** How a call to `submit()` ended. */
export type DraftSubmitResult = 'saved' | 'invalid' | 'failed' | 'busy';

/**
 * The one save in flight: which identity generation it belongs to and, once
 * its request is sent, what it sent and which of those keys the server has
 * echoed (see `PendingSave`).
 */
type ActiveSave<T extends DraftValues> = { id: number; generation: number; pending?: PendingSave<T>; outcome?: 'saved' | 'invalid' | 'failed' };

/**
 * A TanStack form kept in step with server data (operations/ui-overhaul.md
 * §8.3), never silently dropping an edit:
 * - a new `identity` (another site, another language scope) resets the form;
 * - a server change updates fields the person hasn't edited, keeps their
 *   edits, and reports keys both sides changed as `conflicts`, which stay
 *   until resolved or until the draft matches the server again;
 * - one save at a time: `submit()` takes a synchronous lock, so Enter or
 *   Cmd+S during a save can't start a second one; only that save's own
 *   completion releases it;
 * - a refetch during a save reconciles values but never drops the save's
 *   state or its pending flag. The save records what it sent and which keys
 *   it changed when its request goes out; until a refetch echoes a sent key,
 *   the form's value for it is the person's (sent or newer), and the echo is
 *   never a conflict. After the echo the key follows the normal rules;
 * - after a save, edits made while it was in flight survive and stay dirty;
 * - a save's response never rewinds a value a refetch brought during the
 *   save that only someone else's write explains (neither where the save
 *   started nor what it sent): that key confirms the refetched value. An edit
 *   made since the save keeps its conflict, with "theirs" that value. A refetch
 *   that renders only after `succeeded` (TanStack batches observer updates) is
 *   reconciled then, as any server change, and ends the same way;
 * - `isDirty` compares the form with the confirmed baseline, nothing else.
 *
 * Pass `toSent` when the submit handler sends a transformed payload (rows
 * without a key dropped, strings trimmed): the save then records
 * `toSent(values)` as what it sent, so the server storing and echoing that is
 * recognised as the save's own echo and confirms it. The form keeps the raw
 * values: edits made during the save stay visible and dirty, and what
 * `toSent` drops stays in the draft until the save is confirmed. The submit
 * handler still receives the raw values and applies the same transform.
 *
 * The hook owns the form so the form's `defaultValues` is always the
 * baseline (`useForm` re-applies its `defaultValues` on every render while
 * the form is untouched). Always submit through `submit()`, never
 * `form.handleSubmit()`.
 */
export function useServerDraftForm<T extends DraftValues>({
  identity,
  source,
  onSubmit,
  toSent,
}: {
  identity: ReadonlyArray<string | number | null | undefined>;
  source: T;
  onSubmit: (values: T, save: DraftSave<T>) => Promise<'saved' | 'invalid' | 'failed'>;
  /** What the submit handler sends for these values, when it isn't the values themselves. */
  toSent?: (values: T) => T;
}) {
  const identityKey = JSON.stringify(identity);
  const [baseline, setBaselineState] = useState<T>(source);
  const baselineRef = useRef(baseline);
  const identityRef = useRef(identityKey);
  const lastSource = useRef(source);
  // Bumped on every identity change, so a save that started for an earlier
  // identity (even one we came back to) can recognise it no longer applies.
  const generationRef = useRef(0);
  const activeRef = useRef<ActiveSave<T> | null>(null);
  const nextSaveId = useRef(0);
  const [isSaving, setIsSaving] = useState(false);
  const [conflicts, setConflicts] = useState<Array<keyof T & string>>([]);
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const toSentRef = useRef(toSent);
  toSentRef.current = toSent;

  const setBaseline = useCallback((next: T) => {
    baselineRef.current = next;
    setBaselineState(next);
  }, []);

  const release = useCallback((save: ActiveSave<T>) => {
    if (activeRef.current?.id !== save.id) return;
    activeRef.current = null;
    setIsSaving(false);
  }, []);

  const form = useForm({
    defaultValues: baseline,
    onSubmit: async ({ value }) => {
      const save = activeRef.current;
      if (!save) return;
      save.pending = startSave(baselineRef.current, value, toSentRef.current);
      const isCurrent = () => save.generation === generationRef.current && activeRef.current?.id === save.id;
      save.outcome = await onSubmitRef.current(value, {
        baseline: baselineRef.current,
        succeeded: (confirmed) => {
          if (isCurrent()) succeededRef.current(save, confirmed);
        },
        failed: () => {
          // Nothing was confirmed: the edits stay and later refetches follow the normal rules.
          if (isCurrent()) save.pending = undefined;
        },
        isCurrent,
      });
    },
  });

  /** Applies `next` to the form field by field; never resets meta or pending state. */
  const applyValues = useCallback(
    (next: T) => {
      const current = form.state.values as T;
      for (const key of Object.keys(next)) {
        if (!deepEqual(current[key], next[key])) (form.setFieldValue as (field: string, value: unknown) => void)(key, next[key]);
      }
    },
    [form],
  );

  /**
   * Keeps a conflict until it is resolved or the draft agrees with the server
   * again (judged as the save in flight judges its keys); adds new ones.
   */
  const mergeConflicts = useCallback((found: Array<keyof T & string>, current: T, nextBaseline: T, save?: PendingSave<T>) => {
    const agrees = agreesWith(current, nextBaseline, save);
    setConflicts((previous) => {
      const kept = previous.filter((key) => !agrees(key));
      const merged = [...new Set([...kept, ...found])];
      return merged.length === previous.length && merged.every((key, index) => key === previous[index]) ? previous : merged;
    });
  }, []);

  useEffect(() => {
    const identityChanged = identityRef.current !== identityKey;
    if (!identityChanged && deepEqual(lastSource.current, source)) return;
    lastSource.current = source;
    identityRef.current = identityKey;
    if (identityChanged) {
      // Something else to edit: start clean. A save still in flight belongs to
      // the old identity and will find itself no longer current.
      generationRef.current += 1;
      activeRef.current = null;
      setIsSaving(false);
      setConflicts([]);
      setBaseline(source);
      form.reset(source);
      return;
    }
    const current = form.state.values as T;
    const prior = baselineRef.current;
    if (!activeRef.current && !isDraftDirty(current, prior)) {
      // Nothing edited and nothing saving: take the server's values.
      setConflicts([]);
      setBaseline(source);
      form.reset(source);
      return;
    }
    // Edits or a save in flight: merge without resetting anything. The save's
    // state tells its own echo apart from someone else's change.
    const save = activeRef.current;
    const change = reconcileServerChange({ baseline: prior, current, next: source, save: save?.pending });
    if (save && change.save) save.pending = change.save;
    setBaseline(change.baseline);
    applyValues(change.current);
    mergeConflicts(change.conflicts, change.current, change.baseline, change.save);
  }, [applyValues, form, identityKey, mergeConflicts, setBaseline, source]);

  const succeeded = (save: ActiveSave<T>, confirmed?: T) => {
    const pending = save.pending;
    if (!pending) return;
    const result = reconcileSaveSuccess({
      submitted: pending.values,
      current: form.state.values as T,
      confirmed,
      during: { save: pending, baseline: baselineRef.current },
    });
    // The save is over: until its lock releases, refetches follow the normal rules.
    save.pending = undefined;
    lastSource.current = result.baseline;
    setBaseline(result.baseline);
    form.reset(result.baseline);
    applyValues(result.current);
    setConflicts((previous) => previous.filter((key) => !deepEqual(result.current[key], result.baseline[key])));
  };
  const succeededRef = useRef(succeeded);
  succeededRef.current = succeeded;

  /**
   * Validates and saves. Returns 'busy' (and does nothing) while another save
   * from this form is in flight.
   */
  const submit = useCallback(async (): Promise<DraftSubmitResult> => {
    if (activeRef.current) return 'busy';
    nextSaveId.current += 1;
    const save: ActiveSave<T> = { id: nextSaveId.current, generation: generationRef.current };
    activeRef.current = save;
    setIsSaving(true);
    try {
      await form.handleSubmit();
      // A save for an identity the form has since left reports nothing useful to this form.
      return save.generation === generationRef.current ? (save.outcome ?? 'invalid') : 'failed';
    } finally {
      release(save);
    }
  }, [form, release]);

  const values = useStore(form.store, (state) => state.values) as T;
  const isDirty = isDraftDirty(values, baseline);

  const discard = useCallback(() => {
    if (activeRef.current) return;
    setConflicts([]);
    form.reset(baselineRef.current);
  }, [form]);

  const resolveConflict = useCallback(
    (key: keyof T & string, choice: 'theirs' | 'mine') => {
      applyValues(resolveConflictValues({ baseline: baselineRef.current, current: form.state.values as T, key, choice }));
      setConflicts((previous) => previous.filter((item) => item !== key));
    },
    [applyValues, form],
  );

  return { form, baseline, isDirty, isSaving, conflicts, submit, discard, resolveConflict };
}
