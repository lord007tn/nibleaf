// @vitest-environment jsdom

import { ConfirmProvider, useConfirm, usePrompt } from '@nibleaf/design-system/components/ui/confirm';
import { act, type ReactElement } from 'react';
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
  return { container, root };
}

type Api = { confirm: ReturnType<typeof useConfirm>; prompt: ReturnType<typeof usePrompt> };

function Capture({ api }: { api: Partial<Api> }) {
  api.confirm = useConfirm();
  api.prompt = usePrompt();
  return null;
}

const buttonByText = (text: string) => [...document.querySelectorAll('button')].find((button) => button.textContent === text);

describe('useConfirm settling', () => {
  it('settles a pending confirmation as false when a new one replaces it', async () => {
    const api: Partial<Api> = {};
    await render(
      <ConfirmProvider>
        <Capture api={api} />
      </ConfirmProvider>,
    );
    const first = vi.fn();
    const second = vi.fn();
    await act(async () => void api.confirm?.({ title: 'Delete page?' }).then(first));
    await act(async () => void api.confirm?.({ title: 'Delete site?', confirmLabel: 'Delete site' }).then(second));
    expect(first).toHaveBeenCalledWith(false);
    expect(second).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Delete site?');
    await act(async () => buttonByText('Delete site')?.click());
    expect(second).toHaveBeenCalledWith(true);
  });

  it('settles a pending prompt as null when a new one replaces it', async () => {
    const api: Partial<Api> = {};
    await render(
      <ConfirmProvider>
        <Capture api={api} />
      </ConfirmProvider>,
    );
    const first = vi.fn();
    await act(async () => void api.prompt?.({ title: 'Rename' }).then(first));
    await act(async () => void api.prompt?.({ title: 'Rename again' }));
    expect(first).toHaveBeenCalledWith(null);
  });

  it('settles pending questions when the provider unmounts', async () => {
    const api: Partial<Api> = {};
    const { root } = await render(
      <ConfirmProvider>
        <Capture api={api} />
      </ConfirmProvider>,
    );
    const confirmed = vi.fn();
    const prompted = vi.fn();
    await act(async () => void api.confirm?.({ title: 'Delete page?' }).then(confirmed));
    await act(async () => void api.prompt?.({ title: 'Rename' }).then(prompted));
    await act(async () => root.unmount());
    roots.splice(0);
    expect(confirmed).toHaveBeenCalledWith(false);
    expect(prompted).toHaveBeenCalledWith(null);
  });
});

describe('useConfirm focus', () => {
  it('returns focus to the page h1 when the trigger is gone', async () => {
    const api: Partial<Api> = {};
    const { container } = await render(
      <ConfirmProvider>
        <h1>Members</h1>
        <Capture api={api} />
      </ConfirmProvider>,
    );
    const trigger = document.createElement('button');
    trigger.textContent = 'Remove Ada';
    container.append(trigger);
    trigger.focus();
    const settled = vi.fn();
    await act(async () => void api.confirm?.({ title: 'Remove Ada?', cancelLabel: 'Keep' }).then(settled));
    // The row (and its trigger) disappears while the dialog is open.
    trigger.remove();
    await act(async () => buttonByText('Keep')?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(settled).toHaveBeenCalledWith(false);
    const heading = document.querySelector('h1');
    expect(document.activeElement).toBe(heading);
    expect(heading?.getAttribute('tabindex')).toBe('-1');
  });

  it('returns focus to the trigger when it is still there', async () => {
    const api: Partial<Api> = {};
    const { container } = await render(
      <ConfirmProvider>
        <h1>Members</h1>
        <Capture api={api} />
      </ConfirmProvider>,
    );
    const trigger = document.createElement('button');
    trigger.textContent = 'Remove Ada';
    container.append(trigger);
    trigger.focus();
    await act(async () => void api.confirm?.({ title: 'Remove Ada?', cancelLabel: 'Keep' }));
    await act(async () => buttonByText('Keep')?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps the original trigger as the focus target when a confirmation replaces another', async () => {
    const api: Partial<Api> = {};
    const { container } = await render(
      <ConfirmProvider>
        <h1>Members</h1>
        <Capture api={api} />
      </ConfirmProvider>,
    );
    const trigger = document.createElement('button');
    trigger.textContent = 'Remove Ada';
    container.append(trigger);
    trigger.focus();
    await act(async () => void api.confirm?.({ title: 'Remove Ada?', cancelLabel: 'Keep' }));
    // Focus is inside the first dialog when the second question replaces it.
    expect(trigger).not.toBe(document.activeElement);
    await act(async () => void api.confirm?.({ title: 'Remove Ada from every site?', cancelLabel: 'Keep all' }));
    await act(async () => buttonByText('Keep all')?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.activeElement).toBe(trigger);
  });

  it('tracks confirm and prompt focus targets separately', async () => {
    const api: Partial<Api> = {};
    const { container } = await render(
      <ConfirmProvider>
        <h1>Pages</h1>
        <Capture api={api} />
      </ConfirmProvider>,
    );
    const renameTrigger = document.createElement('button');
    renameTrigger.textContent = 'Rename';
    container.append(renameTrigger);
    renameTrigger.focus();
    await act(async () => void api.prompt?.({ title: 'Rename page' }));
    // A confirmation asked while the prompt is open must not take over the prompt's target.
    await act(async () => void api.confirm?.({ title: 'Discard changes?', cancelLabel: 'Keep editing' }));
    await act(async () => buttonByText('Keep editing')?.click());
    await act(async () => buttonByText('Cancel')?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.activeElement).toBe(renameTrigger);
  });
});
