import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { restoreFocusFallback } from '../../lib/focus';
import { Button } from './button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog';
import { Input } from './input';
import { Label } from './label';

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}
interface PromptOptions {
  validate?: (value: string) => string | undefined;
  destructive?: boolean;
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
type PromptFn = (options: PromptOptions) => Promise<string | null>;

interface ConfirmProviderLabels {
  cancel?: string;
  delete?: string;
  save?: string;
}

const ConfirmContext = createContext<ConfirmFn | null>(null);
const PromptContext = createContext<PromptFn | null>(null);

/**
 * Styled, promise-based replacements for `window.confirm` / `window.prompt`.
 * Mount once near the root. `useConfirm()` → `await confirm({…})` (true/false);
 * `usePrompt()` → `await prompt({…})` (the entered string, or null on cancel).
 * Theme- and RTL-aware, and non-blocking (unlike the native dialogs).
 *
 * A question that is still open settles as a cancel (`false` / `null`) when a
 * new one of the same kind replaces it or the provider unmounts, so no caller
 * waits forever. On close, focus returns to what had it before, or to the
 * page h1 when that element is gone.
 */
export function ConfirmProvider({ children, labels }: { children: ReactNode; labels?: ConfirmProviderLabels }) {
  const [confirmState, setConfirmState] = useState<{ options: ConfirmOptions } | null>(null);
  const [promptState, setPromptState] = useState<{ options: PromptOptions } | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const returnFocus = useRef<HTMLElement | null>(null);
  // The open question's resolver lives in a ref, not in state, so settling it
  // never runs inside a state updater (React may call those twice).
  const confirmResolve = useRef<((value: boolean) => void) | null>(null);
  const promptResolve = useRef<((value: string | null) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        confirmResolve.current?.(false);
        confirmResolve.current = resolve;
        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setConfirmState({ options });
      }),
    [],
  );
  const prompt = useCallback<PromptFn>(
    (options) =>
      new Promise<string | null>((resolve) => {
        promptResolve.current?.(null);
        promptResolve.current = resolve;
        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setPromptValue(options.initialValue ?? '');
        setPromptState({ options });
      }),
    [],
  );

  useEffect(
    () => () => {
      confirmResolve.current?.(false);
      confirmResolve.current = null;
      promptResolve.current?.(null);
      promptResolve.current = null;
    },
    [],
  );

  const settleConfirm = (result: boolean) => {
    const resolve = confirmResolve.current;
    confirmResolve.current = null;
    resolve?.(result);
    setConfirmState(null);
  };
  const settlePrompt = (result: string | null) => {
    const resolve = promptResolve.current;
    promptResolve.current = null;
    resolve?.(result);
    setPromptState(null);
  };
  const finalFocus = () => restoreFocusFallback(returnFocus.current);

  const confirmValue = useMemo(() => confirm, [confirm]);
  const promptFnValue = useMemo(() => prompt, [prompt]);
  const promptError = promptState?.options.validate?.(promptValue.trim());
  // Only explain a validation problem once the person has typed something; an
  // empty field just keeps the submit button disabled.
  const visiblePromptError = promptValue.trim() ? promptError : undefined;
  const c = confirmState?.options;
  const p = promptState?.options;

  return (
    <ConfirmContext value={confirmValue}>
      <PromptContext value={promptFnValue}>
        {children}

        <Dialog open={Boolean(confirmState)} onOpenChange={(open) => !open && settleConfirm(false)}>
          <DialogContent className="max-w-sm" finalFocus={finalFocus} showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{c?.title}</DialogTitle>
              {c?.description ? <DialogDescription>{c.description}</DialogDescription> : null}
            </DialogHeader>
            <DialogFooter>
              <Button autoFocus={c?.destructive} onClick={() => settleConfirm(false)} variant="outline">
                {c?.cancelLabel ?? labels?.cancel ?? 'Cancel'}
              </Button>
              <Button autoFocus={!c?.destructive} onClick={() => settleConfirm(true)} variant={c?.destructive ? 'destructive' : 'default'}>
                {c?.confirmLabel ?? labels?.delete ?? 'Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(promptState)} onOpenChange={(open) => !open && settlePrompt(null)}>
          <DialogContent className="max-w-sm" finalFocus={finalFocus} showCloseButton={false}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (promptError) return;
                settlePrompt(promptValue.trim() ? promptValue.trim() : null);
              }}
            >
              <DialogHeader>
                <DialogTitle>{p?.title}</DialogTitle>
                {p?.description ? <DialogDescription>{p.description}</DialogDescription> : null}
              </DialogHeader>
              <div className="my-4 flex flex-col gap-1.5">
                {p?.label ? <Label htmlFor="prompt-input">{p.label}</Label> : null}
                <Input
                  autoFocus
                  aria-invalid={Boolean(visiblePromptError)}
                  aria-describedby={visiblePromptError ? "prompt-error" : undefined}
                  dir="auto"
                  id="prompt-input"
                  onChange={(event) => setPromptValue(event.target.value)}
                  placeholder={p?.placeholder}
                  value={promptValue}
                />
                {visiblePromptError ? <p id="prompt-error" role="status" className="text-destructive text-xs">{visiblePromptError}</p> : null}
              </div>
              <DialogFooter>
                <Button onClick={() => settlePrompt(null)} type="button" variant="outline">
                  {labels?.cancel ?? 'Cancel'}
                </Button>
                <Button type="submit" disabled={Boolean(promptError)} variant={p?.destructive ? 'destructive' : 'default'}>{p?.confirmLabel ?? labels?.save ?? 'Save'}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </PromptContext>
    </ConfirmContext>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return ctx;
}

export function usePrompt(): PromptFn {
  const ctx = useContext(PromptContext);
  if (!ctx) {
    throw new Error('usePrompt must be used within a ConfirmProvider');
  }
  return ctx;
}

