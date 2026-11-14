// @vitest-environment jsdom
import { Sidebar, SidebarProvider, SidebarTrigger } from '@nibleaf/design-system/components/ui/sidebar';
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
vi.mock('@/components/app/sidebar-brand', () => ({ SidebarBrand: () => null }));
vi.mock('@/components/app/sidebar-account-footer', () => ({ SidebarAccountFooter: () => null }));

import { OrgSidebar } from './org-sidebar';
import { ProjectSidebar } from './project-sidebar';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});

it.each(['', '   ', '\n\t'])('gives a mobile dialog a default name for blank title %j', async (mobileTitle) => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <SidebarProvider>
        <Sidebar mobileTitle={mobileTitle}>Navigation</Sidebar>
        <SidebarTrigger />
      </SidebarProvider>,
    ),
  );
  await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="sidebar-trigger"]')?.click());
  const dialog = document.querySelector('[role="dialog"]');
  const title = document.getElementById(dialog?.getAttribute('aria-labelledby') ?? '');
  expect(title?.textContent).toBe('Sidebar');
});
it.each(['en', 'ar', 'de'])('labels both mobile dialogs with app-supplied %s text', async (locale) => {
  mocks.locale = locale;
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const sidebars = [
    { element: <OrgSidebar isAdmin key="organization" orgSlug="acme" />, description: 'nav.organizationSidebarDescription' },
    { element: <ProjectSidebar key="project" projectId="fixture" />, description: 'nav.sidebarDescription' },
  ];
  for (const { element: sidebar, description: descriptionKey } of sidebars) {
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
    expect(description?.textContent).toBe(`${locale}:${descriptionKey}`);
  }
});

// Phones have no room for Preview in the site header, so the sheet carries it.
// Its name is the visible "Preview" (label in name); where it goes is the title.
it.each([
  { draft: true, href: '/app/projects/$projectId/preview', title: 'en:project.previewDraftAria' },
  { draft: false, href: '/sites/fixture', title: 'en:project.previewLiveAria' },
])('offers Preview in the phone sheet (draft: $draft)', async ({ draft, href, title }) => {
  mocks.locale = 'en';
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <SidebarProvider>
        <ProjectSidebar previewDraft={draft} projectId="fixture" />
        <SidebarTrigger />
      </SidebarProvider>,
    ),
  );
  await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="sidebar-trigger"]')?.click());
  const link = document.querySelector<HTMLAnchorElement>(`[role="dialog"] a[title="${title}"]`);
  expect(link?.getAttribute('href')).toBe(href);
  expect(link?.hasAttribute('aria-label')).toBe(false);
  expect(link?.textContent).toBe('en:project.preview');
});
