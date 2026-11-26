// @vitest-environment jsdom

import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
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

describe('EmptyState', () => {
  it('renders the title as an h3 by default, with nothing optional', async () => {
    const container = await render(<EmptyState title="No domains yet" />);
    expect(container.querySelector('h3')?.textContent).toBe('No domains yet');
    expect(container.querySelector('p')).toBeNull();
    expect(container.querySelector('[data-slot="empty-state-icon"]')).toBeNull();
    expect(container.querySelector('[data-slot="empty-state-actions"]')).toBeNull();
    const root = container.querySelector('[data-slot="empty-state"]');
    expect(root?.getAttribute('data-size')).toBe('section');
  });

  it.each([2, 4] as const)('takes heading level %i', async (level) => {
    const container = await render(<EmptyState headingLevel={level} title="Nothing here" />);
    expect(container.querySelector('h3')).toBeNull();
    expect(container.querySelector(`h${level}`)?.textContent).toBe('Nothing here');
  });

  it('renders icon, description and both actions on a page', async () => {
    const container = await render(
      <EmptyState
        size="page"
        icon={<svg />}
        title="No websites"
        description="Create a website to start answering visitors."
        action={<button type="button">Create website</button>}
        secondaryAction={<a href="/docs">Read the guide</a>}
      />,
    );
    const icon = container.querySelector('[data-slot="empty-state-icon"]');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    const description = container.querySelector('p');
    expect(description?.textContent).toBe('Create a website to start answering visitors.');
    const actions = container.querySelector('[data-slot="empty-state-actions"]');
    expect(actions?.querySelector('button')?.textContent).toBe('Create website');
    expect(actions?.querySelector('a')?.textContent).toBe('Read the guide');
  });
});
