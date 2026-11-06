// @vitest-environment jsdom

import { ConfirmProvider, usePrompt } from '@nibleaf/design-system/components/ui/confirm';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('retains a mistyped deletion name until an exact match is submitted', async () => {
  const done = vi.fn();
  function Trigger() {
    const prompt = usePrompt();
    return (
      <button
        type="button"
        onClick={() =>
          void prompt({
            title: 'Delete site',
            label: 'Site name',
            validate: (value) => (value === 'Help Center' ? undefined : 'Name does not match'),
            destructive: true,
          }).then(done)
        }
      >
        Delete
      </button>
    );
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <ConfirmProvider>
        <Trigger />
      </ConfirmProvider>,
    ),
  );
  await act(async () => host.querySelector('button')?.click());
  const input = document.querySelector<HTMLInputElement>('#prompt-input');
  expect(input).not.toBeNull();
  const setValue = (value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  };
  await act(async () => setValue('Help'));
  const form = input?.closest('form');
  await act(async () => form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(done).not.toHaveBeenCalled();
  expect(input?.value).toBe('Help');
  expect(document.querySelector('#prompt-error')?.textContent).toBe('Name does not match');
  await act(async () => setValue('Help Center'));
  await act(async () => form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(done).toHaveBeenCalledWith('Help Center');
  await act(async () => root.unmount());
  host.remove();
});
