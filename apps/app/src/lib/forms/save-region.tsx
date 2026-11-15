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

/**
 * What one explicit-save form tells the page's SaveRegion
 * (operations/ui-overhaul.md §5.3). `submit` runs the form's own submit and
 * resolves `'saved'`, `'invalid'` (validation stopped it), `'failed'` (the
 * server refused; the form showed why) or `'deferred'`: the form asked the
 * person first (a confirmation) and saves itself once they answer, so the bar
 * moves on without waiting and without saying "Saved" for it.
 */
export type SaveRegionForm = {
  isDirty: boolean;
  isSubmitting: boolean;
  submit: () => Promise<'saved' | 'invalid' | 'failed' | 'deferred'>;
  discard: () => void;
};

type Registry = {
  register: (id: string, form: SaveRegionForm) => void;
  unregister: (id: string) => void;
  /** Saves one form the way Save does, focusing an invalid field inside `root`. */
  saveForm: (form: SaveRegionForm, root: HTMLFormElement) => Promise<void>;
};

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
  const { isDirty, isSubmitting, submit, discard } = form;
  useEffect(() => {
    register(id, { isDirty, isSubmitting, submit, discard });
  }, [discard, id, isDirty, isSubmitting, register, submit]);
  useEffect(() => () => unregister(id), [id, unregister]);

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
      void saveForm({ isDirty, isSubmitting, submit, discard }, event.currentTarget);
    },
    [discard, isDirty, isSubmitting, saveForm, submit],
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
export function focusFirstInvalid(root: ParentNode | null | undefined) {
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
  const [forms, setForms] = useState<ReadonlyMap<string, SaveRegionForm>>(() => new Map());
  const [status, setStatus] = useState<string>('');
  const [running, setRunning] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const keyboardOpen = useKeyboardOpen();

  const register = useCallback((id: string, form: SaveRegionForm) => {
    setForms((previous) => {
      const existing = previous.get(id);
      if (
        existing &&
        existing.isDirty === form.isDirty &&
        existing.isSubmitting === form.isSubmitting &&
        existing.submit === form.submit &&
        existing.discard === form.discard
      ) {
        return previous;
      }
      const next = new Map(previous);
      next.set(id, form);
      return next;
    });
  }, []);
  const unregister = useCallback((id: string) => {
    setForms((previous) => {
      if (!previous.has(id)) return previous;
      const next = new Map(previous);
      next.delete(id);
      return next;
    });
  }, []);

  const dirtyForms = [...forms.values()].filter((form) => form.isDirty);
  const anyDirty = dirtyForms.length > 0;
  const saving = running || [...forms.values()].some((form) => form.isSubmitting);
  // A save in flight keeps the bar and the leave guard up even if the person
  // typed the value back to what was saved: the request can still change it.
  const unsettled = anyDirty || saving;

  /** Submits `pending` in order and reports the outcome; an invalid one focuses its first field inside `root`. */
  const run = useCallback(
    async (pending: SaveRegionForm[], root: ParentNode | null) => {
      if (running || pending.length === 0) return;
      setRunning(true);
      setStatus('');
      try {
        let deferred = false;
        for (const form of pending) {
          const result = await form.submit();
          if (result === 'deferred') {
            deferred = true;
            continue;
          }
          if (result === 'invalid') {
            setStatus(t('forms.fixHighlighted'));
            focusFirstInvalid(root);
            return;
          }
          if (result === 'failed') return;
        }
        if (!deferred) setStatus(t('common.saved'));
      } finally {
        setRunning(false);
      }
    },
    [running, t],
  );
  const save = useCallback(
    () =>
      run(
        [...forms.values()].filter((form) => form.isDirty),
        rootRef.current,
      ),
    [forms, run],
  );
  const saveForm = useCallback((form: SaveRegionForm, root: HTMLFormElement) => run(form.isDirty ? [form] : [], root), [run]);
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
        status={status}
      />
    </SaveRegionContext.Provider>
  );
}
