// @vitest-environment jsdom

import { CopyButton } from '@nibleaf/design-system/components/ui/copy-button';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
});

async function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return { container, unmount: () => act(async () => root.unmount()) };
}

const liveRegion = (container: HTMLElement) => container.querySelector('[role="status"]') as HTMLElement;
const button = (container: HTMLElement) => container.querySelector('button') as HTMLButtonElement;
const click = (el: HTMLElement) => act(async () => el.click());

describe('CopyButton', () => {
  it('is named by its label and has an empty live region from the first render', async () => {
    const { container } = await render(<CopyButton value="docs.acme.com" label="Copy domain" copiedLabel="Copied" />);
    expect(button(container).getAttribute('aria-label')).toBe('Copy domain');
    expect(button(container).getAttribute('type')).toBe('button');
    expect(button(container).querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    const region = liveRegion(container);
    expect(region).not.toBeNull();
    expect(region.textContent).toBe('');
    expect(region.className).toContain('sr-only');
  });

  it('copies, announces the copied label, then resets after two seconds', async () => {
    const { container } = await render(<CopyButton value="docs.acme.com" label="Copy domain" copiedLabel="Copied" />);
    await click(button(container));
    expect(writeText).toHaveBeenCalledWith('docs.acme.com');
    expect(liveRegion(container).textContent).toBe('Copied');
    expect(button(container).getAttribute('data-state')).toBe('copied');
    // The name stays stable; only the live region speaks.
    expect(button(container).getAttribute('aria-label')).toBe('Copy domain');

    await act(async () => vi.advanceTimersByTime(1999));
    expect(liveRegion(container).textContent).toBe('Copied');
    await act(async () => vi.advanceTimersByTime(1));
    expect(liveRegion(container).textContent).toBe('');
    expect(button(container).getAttribute('data-state')).toBe('idle');
  });

  it('announces the failure label when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const { container } = await render(<CopyButton value="key" label="Copy key" copiedLabel="Copied" failedLabel="Could not copy" />);
    await click(button(container));
    expect(liveRegion(container).textContent).toBe('Could not copy');
    expect(button(container).getAttribute('data-state')).toBe('failed');
  });

  it('stays silent on failure without a failure label', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const { container } = await render(<CopyButton value="key" label="Copy key" copiedLabel="Copied" />);
    await click(button(container));
    expect(liveRegion(container).textContent).toBe('');
  });

  it('renders a text button named by its children', async () => {
    const { container } = await render(
      <CopyButton value="key" label="Copy key" copiedLabel="Copied">
        Copy key
      </CopyButton>,
    );
    expect(button(container).hasAttribute('aria-label')).toBe(false);
    expect(button(container).textContent).toBe('Copy key');
  });

  it('clears its timer on unmount', async () => {
    const { container, unmount } = await render(<CopyButton value="v" label="Copy" copiedLabel="Copied" />);
    await click(button(container));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
