// @vitest-environment jsdom

import { TooltipButton } from '@nibleaf/design-system/components/ui/tooltip-button';
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
  return container;
}

const tooltip = () => document.querySelector('[data-slot="tooltip-content"]');

/** Moves focus the way a keyboard does: a Tab keydown, then focus. */
async function tabTo(element: HTMLElement) {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    element.focus();
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
}

describe('TooltipButton', () => {
  it('opens the disabled reason from the keyboard', async () => {
    const container = await render(<TooltipButton disabledReason="Only Admins can add domains.">Add domain</TooltipButton>);
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(tooltip()).toBeNull();
    await tabTo(button);
    expect(document.activeElement).toBe(button);
    expect(tooltip()?.textContent).toBe('Only Admins can add domains.');
  });

  it('shows its tooltip on keyboard focus when enabled', async () => {
    const container = await render(<TooltipButton tooltip="Copy the address">Copy</TooltipButton>);
    await tabTo(container.querySelector('button') as HTMLButtonElement);
    expect(tooltip()?.textContent).toBe('Copy the address');
  });

  it('renders a plain Button with neither tooltip nor reason', async () => {
    const container = await render(<TooltipButton>Save</TooltipButton>);
    await tabTo(container.querySelector('button') as HTMLButtonElement);
    expect(tooltip()).toBeNull();
  });
});
