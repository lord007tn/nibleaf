// @vitest-environment jsdom
import { SidebarProvider, useSidebar } from '@nibleaf/design-system/components/ui/sidebar';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), useProjects: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/hooks/api', () => ({ useProjects: mocks.useProjects }));

import { SiteSwitcher } from './site-switcher';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.useProjects.mockReturnValue({
    data: [
      { id: 'site-a', name: 'Site A' },
      { id: 'site-b', name: 'Site B' },
    ],
    isPending: false,
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});

function Harness({ projectId }: { projectId?: string }) {
  const { openMobile, setOpenMobile } = useSidebar();
  return (
    <>
      <button type="button" onClick={() => setOpenMobile(true)}>
        Open mobile
      </button>
      <output>{String(openMobile)}</output>
      <SiteSwitcher projectId={projectId} />
    </>
  );
}
async function render(projectId?: string) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <SidebarProvider>
        <Harness projectId={projectId} />
      </SidebarProvider>,
    ),
  );
  await act(async () => host.querySelector<HTMLButtonElement>('button')?.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="dropdown-menu-trigger"]')?.click());
}
const item = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.textContent?.includes(label));

it.each([
  ['Site B', { to: '/app/projects/$projectId', params: { projectId: 'site-b' } }],
  ['nav.workspace', { to: '/app' }],
  ['dashboard.newProject', { to: '/app/sites', search: { newSite: true } }],
])('closes the mobile sheet before selecting %s', async (label, destination) => {
  await render('site-a');
  expect(document.querySelector('output')?.textContent).toBe('true');
  await act(async () => item(label as string)?.click());
  expect(document.querySelector('output')?.textContent).toBe('false');
  expect(mocks.navigate).toHaveBeenCalledWith(destination);
});

it('keeps the project scope on failure and retries without dismissing the menu', async () => {
  const refetch = vi.fn();
  mocks.useProjects.mockReturnValue({ isError: true, isPending: false, refetch });
  await render('site-a');
  const trigger = document.querySelector('[data-slot="dropdown-menu-trigger"]');
  expect(trigger?.textContent).toContain('nav.site');
  expect(trigger?.textContent).not.toContain('project.allSites');
  expect(trigger?.textContent).not.toContain('nav.workspace');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('nav.sitesLoadError');
  await act(async () => item('error.tryAgain')?.click());
  expect(refetch).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  expect(mocks.navigate).not.toHaveBeenCalled();
  mocks.useProjects.mockReturnValue({ data: [{ id: 'site-a', name: 'Recovered site' }], isError: false });
  await act(async () =>
    root.render(
      <SidebarProvider>
        <Harness projectId="site-a" />
      </SidebarProvider>,
    ),
  );
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('[data-slot="dropdown-menu-trigger"]')?.textContent).toContain('Recovered site');
});

it('retains cached site choices and the current name on a background error', async () => {
  mocks.useProjects.mockReturnValue({ data: [{ id: 'site-a', name: 'Cached site' }], isError: true, refetch: vi.fn() });
  await render('site-a');
  expect(document.querySelector('[data-slot="dropdown-menu-trigger"]')?.textContent).toContain('Cached site');
  expect(item('Cached site')).toBeDefined();
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
});
