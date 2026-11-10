import { SaveRegion } from '@nibleaf/design-system/components/ui/save-region';
import { useT } from '@nibleaf/i18n/react';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DirtyStateReporter } from '@/components/project-settings/shared';

/**
 * What one explicit-save form tells the page's SaveRegion
 * (operations/ui-overhaul.md §5.3). `submit` runs the form's own submit and
 * resolves `'saved'`, `'invalid'` (validation stopped it) or `'failed'` (the
 * server refused; the form showed why).
 */
export type SaveRegionForm = {
  isDirty: boolean;
  isSubmitting: boolean;
  submit: () => Promise<'saved' | 'invalid' | 'failed'>;
  discard: () => void;
};

type Registry = {
  register: (id: string, form: SaveRegionForm) => void;
  unregister: (id: string) => void;
};

const SaveRegionContext = createContext<Registry | null>(null);

/** Registers an explicit-save form with the page's SaveRegion while mounted. */
export function useSaveRegionForm(id: string, form: SaveRegionForm) {
  const registry = useContext(SaveRegionContext);
  if (!registry) throw new Error('useSaveRegionForm must be used inside SaveRegionProvider');
  const { register, unregister } = registry;
  const { isDirty, isSubmitting, submit, discard } = form;
  useEffect(() => {
    register(id, { isDirty, isSubmitting, submit, discard });
  }, [discard, id, isDirty, isSubmitting, register, submit]);
  useEffect(() => () => unregister(id), [id, unregister]);
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
  const registry = useMemo(() => ({ register, unregister }), [register, unregister]);

  const dirtyForms = [...forms.values()].filter((form) => form.isDirty);
  const anyDirty = dirtyForms.length > 0;
  const saving = running || [...forms.values()].some((form) => form.isSubmitting);
  // A save in flight keeps the bar and the leave guard up even if the person
  // typed the value back to what was saved: the request can still change it.
  const unsettled = anyDirty || saving;

  const save = useCallback(async () => {
    if (running) return;
    const pending = [...forms.values()].filter((form) => form.isDirty);
    if (pending.length === 0) return;
    setRunning(true);
    setStatus('');
    try {
      for (const form of pending) {
        const result = await form.submit();
        if (result === 'invalid') {
          setStatus(t('forms.fixHighlighted'));
          focusFirstInvalid(rootRef.current);
          return;
        }
        if (result === 'failed') return;
      }
      setStatus(t('common.saved'));
    } finally {
      setRunning(false);
    }
  }, [forms, running, t]);

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
