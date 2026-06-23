import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useT } from '@/lib/i18n';

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Styled, promise-based replacement for `window.confirm`. Mount once near the
 * root; call `const confirm = useConfirm()` then `await confirm({ title, … })`
 * — resolves true on confirm, false on cancel/dismiss. Unlike the native dialog
 * it is theme-aware, RTL-aware, and doesn't block the event loop.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: (value: boolean) => void } | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => new Promise<boolean>((resolve) => setState({ options, resolve })), []);

  const settle = (result: boolean) =>
    setState((current) => {
      current?.resolve(result);
      return null;
    });

  const value = useMemo(() => confirm, [confirm]);
  const opts = state?.options;

  return (
    <ConfirmContext value={value}>
      {children}
      <Dialog open={Boolean(state)} onOpenChange={(open) => !open && settle(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{opts?.title}</DialogTitle>
            {opts?.description ? <DialogDescription>{opts.description}</DialogDescription> : null}
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => settle(false)} variant="outline">
              {opts?.cancelLabel ?? t('common.cancel')}
            </Button>
            <Button autoFocus onClick={() => settle(true)} variant={opts?.destructive ? 'destructive' : 'default'}>
              {opts?.confirmLabel ?? t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
