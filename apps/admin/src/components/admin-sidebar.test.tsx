// @vitest-environment jsdom
import { SidebarProvider, SidebarTrigger } from '@nibleaf/design-system/components/ui/sidebar';
import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ locale: 'en' }));
vi.mock('@nibleaf/design-system/hooks/use-mobile', () => ({ useIsMobile: () => true }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => `${mocks.locale}:${key}` }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: null }), signOut: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) => select({ location: { pathname: '/' } }),
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

import { AdminSidebar } from './admin-sidebar';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});

it.each(['en', 'ar', 'de'])('uses localized admin labels for the mobile dialog (%s)', async (locale) => {
  mocks.locale = locale;
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <SidebarProvider>
        <AdminSidebar />
        <SidebarTrigger />
      </SidebarProvider>,
    ),
  );
  await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="sidebar-trigger"]')?.click());
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(document.getElementById(dialog?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(`${locale}:admin.meta.title`);
  expect(document.getElementById(dialog?.getAttribute('aria-describedby') ?? '')?.textContent).toBe(`${locale}:admin.sidebarDescription`);
});
