import { useForm, useStore } from '@tanstack/react-form';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type DraftValues,
  deepEqual,
  isDraftDirty,
  reconcileSaveSuccess,
  reconcileServerChange,
  resolveConflict as resolveConflictValues,
} from './server-draft';

/** What a submit handler gets besides the values, to report how its save went. */
export type DraftSave<T extends DraftValues> = {
  /** The baseline the save is relative to (what the server last confirmed when it started). */
  baseline: T;
  /** Call after the server confirmed. Pass its normalized values when it returned them. */
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

/** The one save in flight: what it sent and which identity generation it belongs to. */
type ActiveSave<T> = { id: number; generation: number; snapshot: T; outcome?: 'saved' | 'invalid' | 'failed' };

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
 *   snapshot or its pending state;
 * - after a save, edits made while it was in flight survive and stay dirty;
 * - `isDirty` compares the form with the confirmed baseline, nothing else.
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
}: {
  identity: ReadonlyArray<string | number | null | undefined>;
  source: T;
  onSubmit: (values: T, save: DraftSave<T>) => Promise<'saved' | 'invalid' | 'failed'>;
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
      save.snapshot = value;
      const isCurrent = () => save.generation === generationRef.current && activeRef.current?.id === save.id;
      save.outcome = await onSubmitRef.current(value, {
        baseline: baselineRef.current,
        succeeded: (confirmed) => {
          if (isCurrent()) succeededRef.current(save, confirmed);
        },
        failed: () => undefined,
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

  /** Keeps a conflict until it is resolved or the draft agrees with the server again; adds new ones. */
  const mergeConflicts = useCallback((found: Array<keyof T & string>, current: T, nextBaseline: T) => {
    setConflicts((previous) => {
      const kept = previous.filter((key) => !deepEqual(current[key], nextBaseline[key]));
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
    // Edits or a save in flight: merge without resetting anything.
    const change = reconcileServerChange({ baseline: prior, current, next: source });
    setBaseline(change.baseline);
    applyValues(change.current);
    mergeConflicts(change.conflicts, change.current, change.baseline);
  }, [applyValues, form, identityKey, mergeConflicts, setBaseline, source]);

  const succeeded = (save: ActiveSave<T>, confirmed?: T) => {
    const result = reconcileSaveSuccess({ submitted: save.snapshot, current: form.state.values as T, confirmed });
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
    const save: ActiveSave<T> = { id: nextSaveId.current, generation: generationRef.current, snapshot: form.state.values as T };
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
