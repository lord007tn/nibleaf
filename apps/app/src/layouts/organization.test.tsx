// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({ useRouterState: () => '/app/o/acme/websites' }));
vi.mock('@/components/app/notifications-popover', () => ({ NotificationsPopover: () => <button type="button">inbox</button> }));
vi.mock('@/components/app/org-sidebar', () => ({ ORG_NAV: [], OrgSidebar: () => <nav aria-label="Organization">nav</nav> }));
vi.mock('@/components/app/org-switcher/organization-switcher', () => ({ OrganizationSwitcher: () => <button type="button">org</button> }));
vi.mock('@/components/app/shell-search-button', () => ({ ShellSearchButton: () => <button type="button">search</button> }));

import { OrganizationLayout } from './organization';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })),
);
let root: ReturnType<typeof createRoot> | undefined;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

it('has one main landmark after the header, never a focusable generic wrapper around the page', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const children: ReactNode = <h1 data-testid="content">Websites</h1>;
  await act(async () =>
    root?.render(
      <OrganizationLayout orgSlug="acme" organization={undefined}>
        {children}
      </OrganizationLayout>,
    ),
  );
  const mains = host.querySelectorAll('main');
  expect(mains).toHaveLength(1);
  const main = mains[0];
  expect(main?.id).toBe('main-content');
  expect(main?.querySelector('[data-testid="content"]')).not.toBeNull();
  expect(main?.querySelector('header')).toBeNull();
  expect(host.querySelector('[data-slot="sidebar-inset"]')?.tagName).toBe('DIV');
  expect(host.querySelector('div[tabindex="-1"]')).toBeNull();
});
