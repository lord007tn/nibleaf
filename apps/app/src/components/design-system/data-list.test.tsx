// @vitest-environment jsdom

import { DataList, DataListEmpty, DataListItem, DataListSkeleton, RowActions, RowActionsItem } from '@nibleaf/design-system/components/ui/data-list';
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

describe('DataList', () => {
  it('renders a labelled list of rows with their slots', async () => {
    const container = await render(
      <DataList aria-label="Domains">
        <DataListItem
          title="a-very-long-subdomain.docs.acme.com"
          description="Primary"
          meta="Added 3 May"
          badges={<span>Verified</span>}
          trailing={<button type="button">Remove</button>}
        />
        <DataListItem title="docs.acme.dev" />
      </DataList>,
    );
    const list = container.querySelector('ul');
    expect(list?.getAttribute('aria-label')).toBe('Domains');
    expect(list?.className).toContain('divide-y');
    expect(list?.className).not.toContain('border-border bg-card');
    const items = list?.querySelectorAll(':scope > li') ?? [];
    expect(items).toHaveLength(2);
    const title = items[0]?.querySelector('[data-slot="data-list-item-title"]');
    expect(title?.textContent).toBe('a-very-long-subdomain.docs.acme.com');
    // Titles wrap; they never truncate.
    expect(title?.className).toContain('break-words');
    expect(title?.className).not.toMatch(/\btruncate\b/);
    expect(items[0]?.className).toContain('@container');
    expect(items[0]?.textContent).toContain('Verified');
    expect(items[0]?.querySelector('[data-slot="data-list-item-trailing"] button')?.textContent).toBe('Remove');
  });

  it('keeps row actions on the title line when the row grows', async () => {
    const container = await render(
      <DataList aria-label="Domains">
        <DataListItem
          description={<div style={{ height: 400 }}>DNS records</div>}
          title="docs.acme.com"
          trailing={<button type="button">More</button>}
        />
      </DataList>,
    );
    const layout = container.querySelector('[data-slot="data-list-item"] > div');
    expect(layout?.className).toContain('items-start');
    // Centring would float the actions halfway down an expanded row.
    expect(layout?.className).not.toMatch(/items-center/);
  });

  it('adds its own border when it stands alone', async () => {
    const container = await render(
      <DataList bordered>
        <DataListItem title="docs.acme.com" />
      </DataList>,
    );
    expect(container.querySelector('ul')?.className).toContain('rounded-xl border border-border bg-card');
  });

  it('marks the skeleton busy and announces the loading label', async () => {
    const container = await render(<DataListSkeleton rows={4} loadingLabel="Loading domains…" />);
    const region = container.querySelector('[data-slot="data-list-skeleton"]');
    expect(region?.getAttribute('aria-busy')).toBe('true');
    expect(region?.querySelector('[role="status"]')?.textContent).toBe('Loading domains…');
    expect(region?.querySelectorAll('[data-slot="skeleton-list-row"]')).toHaveLength(4);
  });

  it('renders the empty slot content', async () => {
    const container = await render(
      <DataListEmpty>
        <p>No domains yet</p>
      </DataListEmpty>,
    );
    expect(container.textContent).toBe('No domains yet');
  });
});

describe('RowActions', () => {
  async function openMenu(onRemove = vi.fn()) {
    const container = await render(
      <RowActions label="Actions for docs.acme.com">
        <RowActionsItem onSelect={vi.fn()}>Make primary</RowActionsItem>
        <RowActionsItem destructive disabledReason="The primary domain can't be removed" onSelect={onRemove}>
          Remove
        </RowActionsItem>
      </RowActions>,
    );
    const trigger = container.querySelector('button') as HTMLButtonElement;
    await act(async () => trigger.click());
    return { trigger, onRemove };
  }

  it('names the trigger after the row', async () => {
    const container = await render(
      <RowActions label="Actions for docs.acme.com">
        <RowActionsItem>Remove</RowActionsItem>
      </RowActions>,
    );
    const triggers = container.querySelectorAll('button');
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.getAttribute('aria-label')).toBe('Actions for docs.acme.com');
    expect(triggers[0]?.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('shows a disabled item with its reason as visible text', async () => {
    const { onRemove } = await openMenu();
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual(['Make primary', "RemoveThe primary domain can't be removed"]);
    const remove = items[1] as HTMLElement;
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(remove.querySelector('[data-slot="row-actions-item-reason"]')?.textContent).toBe("The primary domain can't be removed");
    await act(async () => remove.click());
    expect(onRemove).not.toHaveBeenCalled();
  });
});
