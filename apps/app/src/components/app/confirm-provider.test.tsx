/** @vitest-environment jsdom */
import { ConfirmProvider, useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('confirmation focus', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function openConfirmation(destructive: boolean) {
    const settled = vi.fn();
    function Trigger() {
      const confirm = useConfirm();
      return (
        <button
          type="button"
          onClick={() =>
            void confirm({ title: 'Unsaved changes', description: 'Choose whether to continue.', confirmLabel: 'Continue', destructive }).then(
              settled,
            )
          }
        >
          Open confirmation
        </button>
      );
    }
    await act(async () =>
      root.render(
        <ConfirmProvider>
          <Trigger />
        </ConfirmProvider>,
      ),
    );
    const trigger = container.querySelector('button');
    if (!trigger) throw new Error('Confirmation trigger was not rendered');
    await act(async () => trigger.click());
    return settled;
  }

  it('focuses Cancel for destructive confirmations and safely dismisses from that focused action', async () => {
    const settled = await openConfirmation(true);
    const cancel = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Cancel');
    expect(cancel).toBeDefined();
    expect(document.activeElement).toBe(cancel);
    if (!(document.activeElement instanceof HTMLButtonElement)) throw new Error('Confirmation did not focus an action');
    await act(async () => (document.activeElement as HTMLButtonElement).click());
    expect(settled).toHaveBeenCalledWith(false);
  });

  it('keeps the affirmative action focused for a non-destructive confirmation', async () => {
    const settled = await openConfirmation(false);
    const proceed = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Continue');
    expect(proceed).toBeDefined();
    expect(document.activeElement).toBe(proceed);
    if (!(document.activeElement instanceof HTMLButtonElement)) throw new Error('Confirmation did not focus an action');
    await act(async () => (document.activeElement as HTMLButtonElement).click());
    expect(settled).toHaveBeenCalledWith(true);
  });
});
