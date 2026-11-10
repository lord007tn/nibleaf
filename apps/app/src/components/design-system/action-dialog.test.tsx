// @vitest-environment jsdom

import { ActionDialog, type ActionDialogProps } from '@nibleaf/design-system/components/ui/action-dialog';
import { act, type ReactElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

async function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return container;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type HarnessProps = Omit<ActionDialogProps, 'open' | 'onOpenChange'> & { onOpenChange?: (open: boolean) => void };

/** Opens the dialog and mirrors its open state, like a caller would. */
function Harness({ onOpenChange, ...props }: HarnessProps) {
  const [open, setOpen] = useState(true);
  return (
    <ActionDialog
      {...(props as ActionDialogProps)}
      open={open}
      onOpenChange={(next) => {
        onOpenChange?.(next);
        setOpen(next);
      }}
    />
  );
}

/** The name a screen reader computes from content, skipping hidden layers (the Button loading test models this the same way). */
function accessibleName(el: Element): string {
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label') ?? '';
  let name = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) name += node.textContent ?? '';
    else if (node instanceof Element && node.getAttribute('aria-hidden') !== 'true' && !node.classList.contains('invisible')) {
      name += accessibleName(node);
    }
  }
  return name.trim();
}

const button = (text: string) => {
  const match = [...document.querySelectorAll('button')].find((el) => accessibleName(el) === text);
  if (!match) throw new Error(`No button "${text}"`);
  return match;
};
const dialog = () => document.querySelector('[role="dialog"]');

async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const baseProps = {
  title: 'Remove Ada?',
  description: 'Ada loses access to every site.',
  confirmLabel: 'Remove',
  cancelLabel: 'Keep',
  pendingLabel: 'Removing…',
};

describe('ActionDialog', () => {
  it('ignores a second confirm and blocks closing while the action runs', async () => {
    const action = deferred();
    const onConfirm = vi.fn(() => action.promise);
    const onOpenChange = vi.fn();
    await render(<Harness {...baseProps} destructive onConfirm={onConfirm} onOpenChange={onOpenChange} />);

    await act(async () => button('Remove').click());
    const confirm = button('Removing…');
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    await act(async () => confirm.click());
    expect(onConfirm).toHaveBeenCalledOnce();

    await act(async () => button('Keep').click());
    await act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();

    await act(async () => action.resolve());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('stays open and shows the error when the action fails, then allows a retry', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error('500')).mockResolvedValueOnce(undefined);
    const onOpenChange = vi.fn();
    await render(<Harness {...baseProps} onConfirm={onConfirm} onOpenChange={onOpenChange} errorMessage={() => "Couldn't remove Ada. Try again."} />);
    await act(async () => button('Remove').click());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Couldn't remove Ada. Try again.");
    const confirm = button('Remove');
    expect(confirm.getAttribute('aria-disabled')).not.toBe('true');

    await act(async () => confirm.click());
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows the mismatch error and focuses the field instead of confirming', async () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    await render(
      <Harness
        {...baseProps}
        destructive
        confirmLabel="Delete site"
        confirmText="docs"
        confirmTextLabel="Type docs to confirm"
        confirmTextMismatch="Type docs exactly as shown"
        onConfirm={onConfirm}
      />,
    );
    const input = document.querySelector('input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    await typeInto(input, 'Docs');
    const confirm = button('Delete site');
    // Never disabled for a mismatch.
    expect(confirm.hasAttribute('disabled')).toBe(false);
    expect(confirm.getAttribute('aria-disabled')).not.toBe('true');
    await act(async () => confirm.click());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const errorId = input.getAttribute('aria-describedby');
    expect(errorId && document.getElementById(errorId)?.textContent).toBe('Type docs exactly as shown');
  });

  it('accepts the text after trimming and NFC normalization', async () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    await render(
      <Harness
        {...baseProps}
        confirmLabel="Delete site"
        confirmText={'café'}
        confirmTextLabel="Type café to confirm"
        confirmTextMismatch="Type café exactly as shown"
        onConfirm={onConfirm}
      />,
    );
    const input = document.querySelector('input') as HTMLInputElement;
    // Decomposed é (e + combining acute) with surrounding spaces, as a paste might give.
    await typeInto(input, '  café ');
    await act(async () => button('Delete site').click());
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain('exactly as shown');
  });

  it('opens on Cancel for destructive actions and on confirm otherwise', async () => {
    await render(<Harness {...baseProps} destructive onConfirm={() => Promise.resolve()} />);
    expect(document.activeElement).toBe(button('Keep'));
    for (const root of roots.splice(0)) await act(async () => root.unmount());
    document.body.replaceChildren();

    await render(<Harness {...baseProps} onConfirm={() => Promise.resolve()} />);
    expect(document.activeElement).toBe(button('Remove'));
  });
});
