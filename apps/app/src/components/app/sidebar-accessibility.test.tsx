// @vitest-environment jsdom
import { SidebarProvider, SidebarTrigger } from '@nibleaf/design-system/components/ui/sidebar';
import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ locale: 'ar' }));
vi.mock('@nibleaf/design-system/hooks/use-mobile', () => ({ useIsMobile: () => true }));
vi.mock('@nibleaf/i18n/react', () => ({ useLocale: () => ({ t: (key: string) => `${mocks.locale}:${key}` }) }));
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) => select({ location: { pathname: '/app' } }),
  Link: ({ to, params: _params, children, ...props }: { to: string; params?: unknown; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/app/site-switcher', () => ({ SiteSwitcher: () => null }));
vi.mock('@/components/app/sidebar-account-footer', () => ({ SidebarAccountFooter: () => null }));

import { AppSidebar } from './app-sidebar';
import { ProjectSidebar } from './project-sidebar';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});
it.each(['en', 'ar', 'de'])('labels both mobile dialogs with app-supplied %s text', async (locale) => {
  mocks.locale = locale;
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  for (const sidebar of [<AppSidebar key="workspace" />, <ProjectSidebar key="project" projectId="fixture" />]) {
    await act(async () =>
      root.render(
        <SidebarProvider key={sidebar.key}>
          {sidebar}
          <SidebarTrigger />
        </SidebarProvider>,
      ),
    );
    await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="sidebar-trigger"]')?.click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const title = document.getElementById(dialog?.getAttribute('aria-labelledby') ?? '');
    const description = document.getElementById(dialog?.getAttribute('aria-describedby') ?? '');
    expect(title?.textContent).toBe(`${locale}:nav.sidebarTitle`);
    expect(description?.textContent).toBe(`${locale}:nav.sidebarDescription`);
  }
});
