import { useForm, useStore } from '@tanstack/react-form';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
   *
   * Returns true when the form then matches what the server confirmed: nothing
   * left to save or resolve. Close, collapse or move on only then; otherwise the
   * form holds an edit or a conflict the person still has to see.
   */
  succeeded: (confirmed?: T) => boolean;
  /** Call after a failed save: nothing is confirmed and the edits stay. */
  failed: () => void;
  /**
   * False while this save's form is off screen or no longer its own: the form
   * unmounted, React hid it (`<Activity>`), or it moved to another identity
   * (or away and back) since the save started. An unmounted form never comes
   * back, so its save stays not current even once another form for the same
   * identity mounts. A hidden form that shows again owns its save again, and
   * a confirmation that came while it was hidden is reconciled then, quietly.
   * While it is false, `succeeded` returns false and touches nothing on
   * screen. Check it before any effect of your own on the form or the screen
   * (a field error, a toast, focus, closing or navigating). The request itself
   * is not cancelled: what it wrote stays written, and cache updates and
   * refetches still follow it.
   */
  isCurrent: () => boolean;
};

/** How a call to `submit()` ended. */
export type DraftSubmitResult = 'saved' | 'invalid' | 'failed' | 'busy';

/**
 * Where the draft stands right now, read from the form itself rather than
 * from the last render: a save's `'saved'` only says the request went
 * through, while this says whether anything is left.
 */
export type DraftSettlement = {
  /**
   * No save in flight and the form matches what the server last confirmed:
   * nothing left to save or resolve (a conflict only stays where the form
   * differs from the baseline).
   */
  settled: boolean;
  /** Changes whenever the form starts over for another identity, so an earlier result can tell it no longer applies. */
  generation: number;
};

/**
 * The one save in flight: which identity generation it belongs to and, once
 * its request is sent, what it sent and which of those keys the server has
 * echoed (see `PendingSave`). `leave` ends its `submit()` when the form moves
 * to another identity.
 */
type ActiveSave<T extends DraftValues> = {
  id: number;
  generation: number;
  pending?: PendingSave<T>;
  outcome?: 'saved' | 'invalid' | 'failed';
  leave?: () => void;
};

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
 * - a save belongs to the form that started it, and is current only while
 *   that form is on screen (see `DraftSave.isCurrent`): a late answer for a
 *   form that unmounted reaches neither a form mounted later nor the screen;
 * - a refetch during a save reconciles values but never drops the save's
 *   state or its pending flag. The save records what it sent and which keys
 *   it changed when its request goes out; until a refetch echoes a sent key,
 *   the form's value for it is the person's (sent or newer), and the echo is
 *   never a conflict. After the echo the key follows the normal rules;
 * - after a save, edits made while it was in flight survive and stay dirty;
 * - a save's response never silently overrides a value a refetch showed
 *   during the save that is neither where the save started, nor what it sent,
 *   nor what the response confirms: where the form holds another value for
 *   that key (sent, edited or kept), it stays, dirty, against the refetched
 *   value, so the conflict survives and "theirs" is the value the person saw.
 *   A refetch that renders only after `succeeded` (TanStack batches observer
 *   updates) is reconciled then, as any server change;
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
  // The source object the effect below last handled. React runs effects again
  // when it shows a hidden form; the same source then is nothing new.
  const handledSource = useRef(source);
  // Bumped on every identity change, so a save that started for an earlier
  // identity (even one we came back to) can recognise it no longer applies.
  const generationRef = useRef(0);
  const activeRef = useRef<ActiveSave<T> | null>(null);
  const nextSaveId = useRef(0);
  // Whether the form is on screen: set when it mounts or React shows it again,
  // cleared when it unmounts or React hides it. A layout effect, so it is
  // already cleared when the commit that removes the form ends, before any
  // later promise continuation can read it. React keeps a hidden form's refs,
  // and drops an unmounted one's, so a save can only come back to the former.
  const shownRef = useRef(false);
  // How a save ended while React kept the form hidden, to reconcile once it shows.
  const heldRef = useRef<{ save: ActiveSave<T>; failed: boolean; confirmed?: T } | null>(null);
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

  // Runs when the save's own request ends, even with the form off screen: React
  // can show a hidden form again with this state, and it must not stay saving.
  const release = useCallback((save: ActiveSave<T>) => {
    if (activeRef.current?.id !== save.id) return;
    activeRef.current = null;
    setIsSaving(false);
  }, []);

  const form = useForm({
    defaultValues: baseline,
    // Each submit names its own save, so validation that ends after an identity
    // switch can't send under the save the new identity has started since.
    onSubmitMeta: { save: null } as { save: ActiveSave<T> | null },
    onSubmit: async ({ value, meta }) => {
      const save = meta.save;
      if (!save) return;
      const owned = () => save.generation === generationRef.current && activeRef.current?.id === save.id;
      const isCurrent = () => shownRef.current && owned();
      // Validation that outlasted the form on screen sends nothing.
      if (!isCurrent()) return;
      save.pending = startSave(baselineRef.current, value, toSentRef.current);
      try {
        save.outcome = await onSubmitRef.current(value, {
          baseline: baselineRef.current,
          succeeded: (confirmed) => {
            if (isCurrent()) return succeededRef.current(save, confirmed);
            // Off screen: held for when the form shows again (an unmounted form never does).
            if (owned()) heldRef.current = { save, failed: false, confirmed };
            return false;
          },
          failed: () => {
            // Nothing was confirmed: the edits stay and later refetches follow the normal rules.
            if (isCurrent()) save.pending = undefined;
            else if (owned()) heldRef.current = { save, failed: true };
          },
          isCurrent,
        });
      } catch (error) {
        // A save the form no longer owns has no one left to tell.
        if (isCurrent()) throw error;
      }
    },
  });

  useLayoutEffect(() => {
    shownRef.current = true;
    return () => {
      shownRef.current = false;
    };
  }, []);

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
    if (!identityChanged && handledSource.current === source) return;
    handledSource.current = source;
    if (!identityChanged && deepEqual(lastSource.current, source)) return;
    lastSource.current = source;
    identityRef.current = identityKey;
    if (identityChanged) {
      // Something else to edit: start clean. A save still in flight belongs to
      // the old identity and will find itself no longer current; its submit
      // ends now, so nothing waiting on it (the save bar) holds up this one's.
      generationRef.current += 1;
      activeRef.current?.leave?.();
      activeRef.current = null;
      heldRef.current = null;
      setIsSaving(false);
      setConflicts([]);
      setBaseline(source);
      form.reset(source);
      return;
    }
    const current = form.state.values as T;
    const prior = baselineRef.current;
    // A save that ended while the form was hidden is still in flight here: its
    // end is reconciled after this, as when a refetch lands during a save.
    const save = activeRef.current ?? heldRef.current?.save;
    if (!save && !isDraftDirty(current, prior)) {
      // Nothing edited and nothing saving: take the server's values.
      setConflicts([]);
      setBaseline(source);
      form.reset(source);
      return;
    }
    // Edits or a save in flight: merge without resetting anything. The save's
    // state tells its own echo apart from someone else's change.
    const change = reconcileServerChange({ baseline: prior, current, next: source, save: save?.pending });
    if (save && change.save) save.pending = change.save;
    setBaseline(change.baseline);
    applyValues(change.current);
    mergeConflicts(change.conflicts, change.current, change.baseline, change.save);
  }, [applyValues, form, identityKey, mergeConflicts, setBaseline, source]);

  // After the source effect, so when React shows a hidden form again, a source
  // it missed is reconciled first, while the save's pending state still tells
  // its echo from someone else's change; then how the save ended.
  useEffect(() => {
    const held = heldRef.current;
    heldRef.current = null;
    if (!held || held.save.generation !== generationRef.current) return;
    if (held.failed) held.save.pending = undefined;
    else succeededRef.current(held.save, held.confirmed);
  }, []);

  const succeeded = (save: ActiveSave<T>, confirmed?: T) => {
    const pending = save.pending;
    if (!pending) return false;
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
    // Not dirty means no conflict either: one stays only where the form differs from the baseline.
    return !isDraftDirty(result.current, result.baseline);
  };
  const succeededRef = useRef(succeeded);
  succeededRef.current = succeeded;

  /**
   * Validates and saves. Returns 'busy' (and does nothing) while another save
   * from this form is in flight.
   */
  const submit = useCallback(async (): Promise<DraftSubmitResult> => {
    if (activeRef.current) return 'busy';
    if (!shownRef.current) return 'failed';
    nextSaveId.current += 1;
    const save: ActiveSave<T> = { id: nextSaveId.current, generation: generationRef.current };
    activeRef.current = save;
    setIsSaving(true);
    const left = new Promise<void>((resolve) => {
      save.leave = resolve;
    });
    try {
      // The request runs on after an identity switch; only the waiting ends.
      await Promise.race([form.handleSubmit({ save }), left]);
      // A save that ends with the form off screen, or on an identity it has since left, reports nothing useful to it.
      return shownRef.current && save.generation === generationRef.current ? (save.outcome ?? 'invalid') : 'failed';
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

  const settlement = useCallback(
    (): DraftSettlement => ({
      settled: !activeRef.current && !isDraftDirty(form.state.values as T, baselineRef.current),
      generation: generationRef.current,
    }),
    [form],
  );

  const resolveConflict = useCallback(
    (key: keyof T & string, choice: 'theirs' | 'mine') => {
      applyValues(resolveConflictValues({ baseline: baselineRef.current, current: form.state.values as T, key, choice }));
      setConflicts((previous) => previous.filter((item) => item !== key));
    },
    [applyValues, form],
  );

  return { form, baseline, isDirty, isSaving, conflicts, submit, discard, resolveConflict, settlement };
}
