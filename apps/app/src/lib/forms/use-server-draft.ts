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

/** What a submit handler gets besides the values, to report how the save went. */
export type DraftSave<T extends DraftValues> = {
  /** The baseline the save is relative to (what the server last confirmed). */
  baseline: T;
  /** Call after the server confirmed. Pass its normalized values when it returned them. */
  succeeded: (confirmed?: T) => void;
  /** Call after a failed save: nothing is confirmed and the edits stay. */
  failed: () => void;
  /**
   * False once the form moved to another identity (or another switch back)
   * after this save started. `succeeded` and `failed` then do nothing; check
   * it before touching the form yourself (e.g. mapping a field error).
   */
  isCurrent: () => boolean;
};

/**
 * A TanStack form kept in step with server data (operations/ui-overhaul.md
 * §8.3), never silently dropping an edit:
 * - a new `identity` (another site, another language scope) resets the form;
 * - a server change updates fields the person hasn't edited, keeps their
 *   edits, and reports keys both sides changed as `conflicts`;
 * - after a save, edits made while it was in flight survive and stay dirty;
 * - `isDirty` compares the form with the confirmed baseline, nothing else.
 *
 * The hook owns the form so the form's `defaultValues` is always the
 * baseline. (`useForm` re-applies its `defaultValues` on every render while
 * the form is untouched, so any other default would undo a reset.)
 *
 * `source` is the normalized editable values (`toValues(query.data)`).
 */
export function useServerDraftForm<T extends DraftValues>({
  identity,
  source,
  onSubmit,
}: {
  identity: ReadonlyArray<string | number | null | undefined>;
  source: T;
  onSubmit: (values: T, save: DraftSave<T>) => Promise<void>;
}) {
  const identityKey = JSON.stringify(identity);
  const [baseline, setBaselineState] = useState<T>(source);
  const baselineRef = useRef(baseline);
  const identityRef = useRef(identityKey);
  const lastSource = useRef(source);
  const submittedRef = useRef<T | null>(null);
  // Bumped on every identity change. A save remembers the generation it began
  // in; if the form has since switched to another identity (even back to the
  // same one), its result belongs to a form that no longer exists.
  const generationRef = useRef(0);
  const [conflicts, setConflicts] = useState<Array<keyof T & string>>([]);
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const setBaseline = useCallback((next: T) => {
    baselineRef.current = next;
    setBaselineState(next);
  }, []);

  const form = useForm({
    defaultValues: baseline,
    onSubmit: async ({ value }) => {
      const generation = generationRef.current;
      const isCurrent = () => generation === generationRef.current;
      submittedRef.current = value;
      await onSubmitRef.current(value, {
        baseline: baselineRef.current,
        succeeded: (confirmed) => {
          if (isCurrent()) succeededRef.current(confirmed);
        },
        failed: () => {
          if (isCurrent()) submittedRef.current = null;
        },
        isCurrent,
      });
    },
  });

  /** Applies `next` to the form, field by field, leaving fields that already hold it alone. */
  const applyValues = useCallback(
    (next: T) => {
      const current = form.state.values as T;
      for (const key of Object.keys(next)) {
        if (!deepEqual(current[key], next[key])) (form.setFieldValue as (field: string, value: unknown) => void)(key, next[key]);
      }
    },
    [form],
  );

  const resetTo = useCallback(
    (next: T) => {
      setBaseline(next);
      form.reset(next);
    },
    [form, setBaseline],
  );

  useEffect(() => {
    const identityChanged = identityRef.current !== identityKey;
    if (!identityChanged && deepEqual(lastSource.current, source)) return;
    lastSource.current = source;
    identityRef.current = identityKey;
    if (identityChanged) generationRef.current += 1;
    const current = form.state.values as T;
    const prior = baselineRef.current;
    if (identityChanged || !isDraftDirty(current, prior)) {
      // Something else to edit, or nothing edited yet: take the server's values.
      submittedRef.current = null;
      setConflicts([]);
      resetTo(source);
      return;
    }
    const change = reconcileServerChange({ baseline: prior, current, next: source });
    setBaseline(change.baseline);
    applyValues(change.current);
    setConflicts(change.conflicts);
  }, [applyValues, form, identityKey, resetTo, setBaseline, source]);

  const succeeded = (confirmed?: T) => {
    const submitted = submittedRef.current ?? (form.state.values as T);
    submittedRef.current = null;
    const result = reconcileSaveSuccess({ submitted, current: form.state.values as T, confirmed });
    lastSource.current = result.baseline;
    resetTo(result.baseline);
    applyValues(result.current);
    setConflicts((previous) => previous.filter((key) => !deepEqual(result.current[key], result.baseline[key])));
  };
  const succeededRef = useRef(succeeded);
  succeededRef.current = succeeded;

  const values = useStore(form.store, (state) => state.values) as T;
  const isDirty = isDraftDirty(values, baseline);

  const discard = useCallback(() => {
    if (submittedRef.current) return;
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

  return { form, baseline, isDirty, conflicts, discard, resolveConflict };
}
