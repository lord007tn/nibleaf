// @vitest-environment jsdom

import { Callout } from '@nibleaf/design-system/components/ui/callout';
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

const callout = (container: HTMLElement) => container.querySelector('[data-slot="callout"]') as HTMLElement;

describe('Callout', () => {
  it.each(['neutral', 'info', 'success'] as const)('is a polite status for %s', async (tone) => {
    const container = await render(<Callout tone={tone}>Drafts are kept for 30 days.</Callout>);
    expect(callout(container).getAttribute('role')).toBe('status');
  });

  it.each(['warning', 'danger'] as const)('has no live role for %s unless urgent', async (tone) => {
    const container = await render(<Callout tone={tone}>Your plan renews tomorrow.</Callout>);
    expect(callout(container).hasAttribute('role')).toBe(false);
  });

  it('becomes an alert only when urgent', async () => {
    const container = await render(
      <Callout tone="danger" urgent>
        Payment failed.
      </Callout>,
    );
    expect(callout(container).getAttribute('role')).toBe('alert');
  });

  it('lets an explicit role win', async () => {
    const container = await render(
      <>
        <Callout tone="info" role="note">
          Note
        </Callout>
        <Callout tone="warning" urgent role="status">
          Status
        </Callout>
      </>,
    );
    const [note, status] = container.querySelectorAll('[data-slot="callout"]');
    expect(note?.getAttribute('role')).toBe('note');
    expect(status?.getAttribute('role')).toBe('status');
  });

  it('renders title, description, a hidden tone icon and an end-aligned action that wraps', async () => {
    const container = await render(
      <Callout tone="warning" title="Domain not verified" action={<button type="button">Verify</button>}>
        Add the TXT record to finish.
      </Callout>,
    );
    const root = callout(container);
    expect(root.querySelector('[data-slot="alert-title"]')?.textContent).toBe('Domain not verified');
    expect(root.querySelector('[data-slot="alert-description"]')?.textContent).toBe('Add the TXT record to finish.');
    expect(root.querySelector(':scope > svg')?.getAttribute('aria-hidden')).toBe('true');
    const action = root.querySelector('[data-slot="callout-action"]');
    expect(action?.textContent).toBe('Verify');
    expect(action?.className).toContain('ms-auto');
    expect(action?.parentElement?.className).toContain('flex-wrap');
  });

  it('drops the icon when icon is null', async () => {
    const container = await render(<Callout icon={null}>Plain</Callout>);
    expect(callout(container).querySelector('svg')).toBeNull();
  });
});
