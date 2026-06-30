import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
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
 */
export function ConfirmProvider({ children, labels }: { children: ReactNode; labels?: ConfirmProviderLabels }) {
  const [confirmState, setConfirmState] = useState<{ options: ConfirmOptions; resolve: (value: boolean) => void } | null>(null);
  const [promptState, setPromptState] = useState<{ options: PromptOptions; resolve: (value: string | null) => void } | null>(null);
  const [promptValue, setPromptValue] = useState('');

  const confirm = useCallback<ConfirmFn>((options) => new Promise<boolean>((resolve) => setConfirmState({ options, resolve })), []);
  const prompt = useCallback<PromptFn>(
    (options) =>
      new Promise<string | null>((resolve) => {
        setPromptValue(options.initialValue ?? '');
        setPromptState({ options, resolve });
      }),
    [],
  );

  const settleConfirm = (result: boolean) =>
    setConfirmState((current) => {
      current?.resolve(result);
      return null;
    });
  const settlePrompt = (result: string | null) =>
    setPromptState((current) => {
      current?.resolve(result);
      return null;
    });

  const confirmValue = useMemo(() => confirm, [confirm]);
  const promptFnValue = useMemo(() => prompt, [prompt]);
  const c = confirmState?.options;
  const p = promptState?.options;

  return (
    <ConfirmContext value={confirmValue}>
      <PromptContext value={promptFnValue}>
        {children}

        <Dialog open={Boolean(confirmState)} onOpenChange={(open) => !open && settleConfirm(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{c?.title}</DialogTitle>
              {c?.description ? <DialogDescription>{c.description}</DialogDescription> : null}
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => settleConfirm(false)} variant="outline">
                {c?.cancelLabel ?? labels?.cancel ?? 'Cancel'}
              </Button>
              <Button autoFocus onClick={() => settleConfirm(true)} variant={c?.destructive ? 'destructive' : 'default'}>
                {c?.confirmLabel ?? labels?.delete ?? 'Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(promptState)} onOpenChange={(open) => !open && settlePrompt(null)}>
          <DialogContent className="max-w-sm">
            <form
              onSubmit={(event) => {
                event.preventDefault();
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
                  id="prompt-input"
                  onChange={(event) => setPromptValue(event.target.value)}
                  placeholder={p?.placeholder}
                  value={promptValue}
                />
              </div>
              <DialogFooter>
                <Button onClick={() => settlePrompt(null)} type="button" variant="outline">
                  {labels?.cancel ?? 'Cancel'}
                </Button>
                <Button type="submit">{p?.confirmLabel ?? labels?.save ?? 'Save'}</Button>
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

