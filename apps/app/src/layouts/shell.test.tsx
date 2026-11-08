// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pathname: '/app', locale: 'en' }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => `${mocks.locale}:${key}` }));
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: mocks.pathname } }),
  Link: ({
    to,
    params,
    children,
    activeOptions: _activeOptions,
    ...props
  }: {
    to: string;
    params?: { projectId: string };
    children: ReactNode;
    activeOptions?: unknown;
  }) => (
    <a href={to.replace('$projectId', params?.projectId ?? '')} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@nibleaf/design-system/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/components/app/app-sidebar', () => ({ AppSidebar: () => null }));
vi.mock('@/components/app/project-sidebar', () => ({ ProjectSidebar: () => null }));
vi.mock('@/components/app/notifications-popover', () => ({ NotificationsPopover: () => null }));
vi.mock('@/components/project/deploy-pipeline', () => ({ DeployPipeline: () => null }));
vi.mock('@/components/project/publish-modal', () => ({ PublishModal: () => null }));
vi.mock('@/hooks/api', () => ({ useProject: () => ({ data: { id: 'fixture', name: 'Long site name / دليل المنتج' } }) }));
vi.mock('@/hooks/use-project-admin-status', () => ({ useProjectAdminStatus: () => ({ edit: 'edit' }) }));

import { DashboardLayout } from './dashboard';
import { ProjectLayout } from './project';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});
async function render(path: string, project = true) {
  mocks.pathname = path;
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(project ? <ProjectLayout projectId="fixture">Content</ProjectLayout> : <DashboardLayout>Content</DashboardLayout>),
  );
}

it.each([
  ['', 'Long site name / دليل المنتج'],
  ['/analytics', 'en:project.analytics'],
  ['/analytics/', 'en:project.analytics'],
  ['/analytics/pages', 'en:analytics.tab.pages'],
  ['/analytics/search', 'en:analytics.tab.search'],
  ['/analytics/feedback', 'en:analytics.tab.feedback'],
  ['/analytics/ai', 'en:analytics.tab.ai'],
  ['/analytics/performance', 'en:analytics.tab.performance'],
  ['/ai', 'en:dashboard.ai.title'],
  ['/settings', 'en:project.settings'],
  ['/preview', 'en:project.preview'],
])('identifies the current project route %s and links its ancestors', async (path, label) => {
  mocks.locale = 'en';
  await render(`/app/projects/fixture${path}`);
  const nav = document.querySelector('[data-slot="breadcrumb"]');
  expect(nav?.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  expect(nav?.querySelector('[aria-current="page"]')?.textContent).toBe(label);
  if (path) expect(nav?.querySelector('a[href="/app/projects/fixture"]')?.textContent).toBe('Long site name / دليل المنتج');
  if (path.startsWith('/analytics/') && path !== '/analytics/')
    expect(nav?.querySelector('a[href="/app/projects/fixture/analytics"]')?.textContent).toBe('en:project.analytics');
  expect(nav?.querySelector('li li')).toBeNull();
});

it.each(['en', 'ar', 'de'])('passes the localized breadcrumb name in both shells (%s)', async (locale) => {
  mocks.locale = locale;
  await render('/app/sites', false);
  const header = document.querySelector('header');
  const workspaceClass = header?.className;
  const searchClass = header?.querySelector(`button[aria-label="${locale}:command.dialog.title"]`)?.className;
  expect(document.querySelector('[data-slot="breadcrumb"]')?.getAttribute('aria-label')).toBe(`${locale}:nav.breadcrumb`);
  await act(async () => root.render(<ProjectLayout projectId="fixture">Content</ProjectLayout>));
  expect(document.querySelector('header')?.className).toBe(workspaceClass);
  expect(document.querySelector(`button[aria-label="${locale}:command.dialog.title"]`)?.className).toBe(searchClass);
  expect(document.querySelector('[data-slot="breadcrumb"]')?.getAttribute('aria-label')).toBe(`${locale}:nav.breadcrumb`);
});
