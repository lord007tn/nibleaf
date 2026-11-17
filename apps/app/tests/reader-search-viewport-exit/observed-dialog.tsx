import type { ComponentProps } from 'react';
import { Dialog as ProductionDialog } from '../../../../packages/design-system/src/components/ui/dialog';
import { observe } from './observe';

export { DialogContent, DialogDescription, DialogTitle } from '../../../../packages/design-system/src/components/ui/dialog';

// Transparent observer: these callbacks are invoked ONLY by the real Dialog.
// Forward immediately, with the original arguments and no timers or overrides.
export function Dialog(props: ComponentProps<typeof ProductionDialog>) {
  return (
    <ProductionDialog
      {...props}
      onOpenChange={(...args) => {
        observe.changes.push({ open: args[0], at: performance.now() });
        props.onOpenChange?.(...args);
      }}
      onOpenChangeComplete={(...args) => {
        observe.completions.push({ open: args[0], at: performance.now(), box: observe.snapshot() });
        props.onOpenChangeComplete?.(...args);
      }}
    />
  );
}
