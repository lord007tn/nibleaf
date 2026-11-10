import { ActionDialog } from '@nibleaf/design-system/components/ui/action-dialog';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

// Runs in Node (no DOM), as server rendering does.
describe('dialogs during server rendering', () => {
  it('renders an ActionDialog that starts open without touching document', () => {
    expect(typeof document).toBe('undefined');
    expect(() =>
      renderToString(
        <ActionDialog
          cancelLabel="Keep"
          confirmLabel="Delete"
          fallbackErrorMessage="Couldn't delete. Try again."
          onConfirm={() => Promise.resolve()}
          onOpenChange={() => undefined}
          open
          title="Delete page?"
        />,
      ),
    ).not.toThrow();
  });
});
