/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './api-key-alert-dialog';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const roots: Array<ReturnType<typeof createRoot>> = [];

const renderDialog = async (onConfirm = vi.fn()) => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const onOpenChange = vi.fn();
  await act(async () => {
    root.render(
      <AlertDialog onOpenChange={onOpenChange} open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>Revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
  });
  return { onConfirm, onOpenChange };
};

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  document.body.replaceChildren();
});

describe('API-key revoke alert dialog', () => {
  it('uses alert semantics, starts on Cancel, and ignores outside pointer dismissal', async () => {
    const { onOpenChange } = await renderDialog();
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
    const cancel = document.querySelector<HTMLButtonElement>('button[type="button"]');
    expect(dialog).not.toBeNull();
    expect(cancel).not.toBeNull();
    expect(document.activeElement).toBe(cancel);
    await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('allows Escape and the focused Cancel control to dismiss without confirming', async () => {
    const first = await renderDialog();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(first.onOpenChange).toHaveBeenCalledWith(false, expect.anything());
    expect(first.onConfirm).not.toHaveBeenCalled();

    const second = await renderDialog();
    const cancelButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter((button) => button.textContent === 'Cancel');
    await act(async () => cancelButtons.at(-1)?.click());
    expect(second.onOpenChange).toHaveBeenCalledWith(false, expect.anything());
    expect(second.onConfirm).not.toHaveBeenCalled();
  });

  it('keeps confirmation as an explicit focusable button action', async () => {
    const { onConfirm } = await renderDialog();
    const action = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Revoke');
    expect(action?.tagName).toBe('BUTTON');
    action?.focus();
    expect(document.activeElement).toBe(action);
    await act(async () => action?.click());
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
