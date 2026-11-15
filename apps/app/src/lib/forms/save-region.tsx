import { SaveRegion } from '@nibleaf/design-system/components/ui/save-region';
import { useT } from '@nibleaf/i18n/react';
import {
  createContext,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DirtyStateReporter } from '@/components/project-settings/shared';
import type { DraftSettlement } from './use-server-draft';

/**
 * What one explicit-save form tells the page's SaveRegion
 * (operations/ui-overhaul.md §5.3). `submit` runs the form's own submit and
 * resolves `'saved'` (the server accepted the request), `'invalid'`
 * (validation stopped it), `'failed'` (the server refused; the form showed
 * why) or `'deferred'`: the form asked the person first (a confirmation) and
 * saves itself once they answer, so the bar moves on without waiting and
 * without saying "Saved" for it.
 *
 * `settlement` reads the form as it is now (`useServerDraftForm`'s
 * `settlement`). An accepted request can still leave an edit made during it,
 * or a conflict, so once the saves end the region says "Saved" only when
 * every registered form is settled. `submit` still resolves `'saved'` for an
 * accepted request either way.
 */
export type SaveRegionForm = {
  isDirty: boolean;
  isSubmitting: boolean;
  submit: () => Promise<'saved' | 'invalid' | 'failed' | 'deferred'>;
  discard: () => void;
  settlement: () => DraftSettlement;
};

/** One mounted form's registration; `instance` tells a remounted form with the same id apart. */
type Registered = SaveRegionForm & { instance: object };

type Registry = {
  register: (id: string, form: Registered) => void;
  unregister: (id: string, instance: object) => void;
  /** Saves one form the way Save does, focusing an invalid field inside `root`. */
  saveForm: (id: string, root: HTMLFormElement) => Promise<void>;
};

/**
 * What the region last announced: after a save, every registered form
 * settled (`saved`), or the save went through but something is left to save
 * or resolve (`unsettled`); or validation stopped it (`invalid`).
 */
type Status = '' | 'saved' | 'unsettled' | 'invalid';
const STATUS_KEY = { saved: 'common.saved', unsettled: 'forms.unsavedChanges', invalid: 'forms.fixHighlighted' } as const;

const SaveRegionContext = createContext<Registry | null>(null);

/** Input types that are an editable single line of text, where Enter means "save". */
const SINGLE_LINE = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number', 'date', 'datetime-local', 'month', 'week', 'time']);

/**
 * Whether a keydown is an Enter that should save: plain Enter in an editable
 * single-line field. Browsers also submit implicitly on Shift+Enter, on Enter
 * in a radio or checkbox, and (Chromium) on an Enter delivered while an IME
 * composition is open; none of those is a request to save.
 */
function isSaveEnter(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return false;
  if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false;
  const { target } = event;
  return target instanceof HTMLInputElement && SINGLE_LINE.has(target.type) && !target.readOnly && !target.disabled;
}

/**
 * Registers an explicit-save form with the page's SaveRegion while mounted.
 * Returns props for the `<form>`: Enter in one of its single-line fields saves
 * this form only (when it is dirty), through the same run as Save. Render
 * `<SaveRegionSubmit />` inside the form so Enter submits it at all.
 */
export function useSaveRegionForm(id: string, form: SaveRegionForm) {
  const registry = useContext(SaveRegionContext);
  if (!registry) throw new Error('useSaveRegionForm must be used inside SaveRegionProvider');
  const { register, unregister, saveForm } = registry;
  const { isDirty, isSubmitting, submit, discard, settlement } = form;
  const [instance] = useState(() => ({}));
  useEffect(() => {
    register(id, { isDirty, isSubmitting, submit, discard, settlement, instance });
  }, [discard, id, instance, isDirty, isSubmitting, register, settlement, submit]);
  useEffect(() => () => unregister(id, instance), [id, instance, unregister]);

  // Implicit submission happens in the same task as its keydown, so a key that
  // must not save only has to be remembered until the task ends. The key
  // itself is never cancelled: the IME, the radio and the newline keep it.
  const ignoreSubmit = useRef(false);
  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter' && event.keyCode !== 229) return;
    if (isSaveEnter(event.nativeEvent)) return;
    ignoreSubmit.current = true;
    setTimeout(() => {
      ignoreSubmit.current = false;
    });
  }, []);
  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      // React bubbles a submit through portals: a dialog's own form is not this one.
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      if (ignoreSubmit.current) return;
      void saveForm(id, event.currentTarget);
    },
    [id, saveForm],
  );
  return { onKeyDown, onSubmit };
}

/**
 * The form's default button, so Enter in a single-line field submits a form
 * with several fields (HTML implicit submission needs one). Hidden: not
 * focusable and not announced; the SaveRegion's Save is the visible one.
 */
export function SaveRegionSubmit() {
  const t = useT();
  return (
    <button hidden type="submit">
      {t('common.save')}
    </button>
  );
}

/** Focuses the first field marked invalid inside `root`, scrolling it into view. */
function focusFirstInvalid(root: ParentNode | null | undefined) {
  const field = root?.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (!field) return false;
  field.focus({ preventScroll: true });
  field.scrollIntoView?.({ block: 'center' });
  return true;
}

/** The on-screen keyboard is open when the visual viewport is much shorter than the layout viewport. */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!viewport || !window.matchMedia?.('(pointer: coarse)').matches) return;
    const update = () => setOpen(viewport.height < window.innerHeight * 0.75);
    update();
    viewport.addEventListener('resize', update);
    return () => viewport.removeEventListener('resize', update);
  }, []);
  return open;
}

/**
 * One SaveRegion for every explicit form inside it. Renders the content, then
 * the bar as the column's last child so it sticks to the bottom of the forms
 * it serves.
 */
export function SaveRegionProvider({ children }: { children: ReactNode }) {
  const t = useT();
  // What renders (the bar, the leave guard) and, beside it, the registrations
  // as they are now, which a save reads when it ends whatever has rendered.
  const [forms, setForms] = useState<ReadonlyMap<string, Registered>>(() => new Map());
  const live = useRef(new Map<string, Registered>());
  const [status, setStatus] = useState<Status>('');
  const [running, setRunning] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const keyboardOpen = useKeyboardOpen();

  const allSettled = useCallback(() => [...live.current.values()].every((form) => form.settlement().settled), []);
  // Once nothing is left anywhere (Discard, Use theirs, an edit typed back), "Unsaved changes" is over: cleared, not announced.
  const clearUnsettled = useCallback(() => {
    if (allSettled()) setStatus((previous) => (previous === 'unsettled' ? '' : previous));
  }, [allSettled]);

  const register = useCallback(
    (id: string, form: Registered) => {
      const existing = live.current.get(id);
      live.current.set(id, form);
      // A new edit makes an earlier "Saved" untrue. It is taken back once,
      // silently; later keystrokes change nothing.
      if (form.isDirty && !existing?.isDirty) setStatus((previous) => (previous === 'saved' ? '' : previous));
      else if (!form.isDirty && existing?.isDirty) clearUnsettled();
      setForms((previous) => {
        const current = previous.get(id);
        if (
          current &&
          current.instance === form.instance &&
          current.isDirty === form.isDirty &&
          current.isSubmitting === form.isSubmitting &&
          current.submit === form.submit &&
          current.discard === form.discard &&
          current.settlement === form.settlement
        ) {
          return previous;
        }
        const next = new Map(previous);
        next.set(id, form);
        return next;
      });
    },
    [clearUnsettled],
  );
  const unregister = useCallback(
    (id: string, instance: object) => {
      const existing = live.current.get(id);
      // A form remounted under the same id has registered itself already: leave it.
      if (existing?.instance !== instance) return;
      live.current.delete(id);
      if (existing.isDirty) clearUnsettled();
      setForms((previous) => {
        if (previous.get(id)?.instance !== instance) return previous;
        const next = new Map(previous);
        next.delete(id);
        return next;
      });
    },
    [clearUnsettled],
  );

  const dirtyForms = [...forms.values()].filter((form) => form.isDirty);
  const anyDirty = dirtyForms.length > 0;
  const saving = running || [...forms.values()].some((form) => form.isSubmitting);
  // A save in flight keeps the bar and the leave guard up even if the person
  // typed the value back to what was saved: the request can still change it.
  const unsettled = anyDirty || saving;

  /**
   * Submits the forms registered as `pending`, in order, and reports the
   * outcome; an invalid one focuses its first field inside `root`. A form that
   * unmounted, or has nothing left to save by its turn, is skipped.
   *
   * "Saved" is decided from the forms' live settlement when the last submit
   * returns, never from the rendered dirty flags, which catch up a render
   * later. Every form saved must still be the same form on the same identity,
   * and every registered form, saved or not, must be settled; otherwise a
   * save that went through says "Unsaved changes".
   */
  const run = useCallback(
    async (pending: string[], root: ParentNode | null) => {
      if (running || pending.length === 0) return;
      setRunning(true);
      setStatus('');
      try {
        let deferred = false;
        const saved: Array<{ id: string; instance: object; generation: number }> = [];
        for (const id of pending) {
          const form = live.current.get(id);
          if (!form) continue;
          const { settled, generation } = form.settlement();
          if (settled) continue;
          const result = await form.submit();
          if (result === 'deferred') {
            deferred = true;
            continue;
          }
          if (result === 'invalid') {
            setStatus('invalid');
            focusFirstInvalid(root);
            return;
          }
          if (result === 'failed') return;
          saved.push({ id, instance: form.instance, generation });
        }
        if (deferred || saved.length === 0) return;
        // A save for a form since replaced, or for an identity it has since left (site A → B → A), says nothing here.
        const current = saved.every(({ id, instance, generation }) => {
          const form = live.current.get(id);
          return form?.instance === instance && form.settlement().generation === generation;
        });
        if (current) setStatus(allSettled() ? 'saved' : 'unsettled');
      } finally {
        setRunning(false);
      }
    },
    [allSettled, running],
  );
  const save = useCallback(
    () =>
      run(
        [...live.current].filter(([, form]) => form.isDirty).map(([id]) => id),
        rootRef.current,
      ),
    [run],
  );
  const saveForm = useCallback((id: string, root: HTMLFormElement) => run(live.current.get(id)?.isDirty ? [id] : [], root), [run]);
  const registry = useMemo(() => ({ register, unregister, saveForm }), [register, unregister, saveForm]);

  const discard = useCallback(() => {
    if (saving) return;
    for (const form of forms.values()) if (form.isDirty) form.discard();
    setStatus('');
  }, [forms, saving]);

  // Cmd/Ctrl+S saves while there is something to save; otherwise the browser's own shortcut is left alone.
  useEffect(() => {
    if (!anyDirty) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [anyDirty, save]);

  return (
    <SaveRegionContext.Provider value={registry}>
      <div className="contents" ref={rootRef}>
        {children}
      </div>
      {/* One dirty source for the route's unsaved-changes guard. */}
      <DirtyStateReporter dirty={unsettled} />
      <SaveRegion
        discardLabel={t('forms.discard')}
        docked={keyboardOpen}
        label={t('forms.unsavedChanges')}
        message={t('forms.unsavedChanges')}
        onDiscard={discard}
        onSave={() => void save()}
        open={unsettled}
        saveLabel={t('common.save')}
        saving={saving}
        savingLabel={t('common.saving')}
        status={status ? t(STATUS_KEY[status]) : ''}
      />
    </SaveRegionContext.Provider>
  );
}
