// @vitest-environment jsdom
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@nibleaf/design-system/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/components/app/project-sidebar', () => ({ ProjectSidebar: () => null }));
vi.mock('@/components/app/notifications-popover', () => ({ NotificationsPopover: () => null }));
vi.mock('@/components/project/deploy-pipeline', () => ({ DeployPipeline: () => null }));
vi.mock('@/components/project/publish-modal', () => ({ PublishModal: () => null }));
vi.mock('@/hooks/api', () => ({ useProject: () => ({ data: { id: 'fixture', name: 'Acme API Reference' } }) }));
vi.mock('@/hooks/use-project-admin-status', () => ({ useProjectAdminStatus: () => ({ edit: 'edit' }) }));

import { ProjectLayout } from './project';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('marks only the leaf current when the real router matches analytics ancestors', async () => {
  const rootRoute = createRootRoute({ component: Outlet });
  const project = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app/projects/$projectId',
    component: () => (
      <ProjectLayout projectId="fixture">
        <Outlet />
      </ProjectLayout>
    ),
  });
  const analytics = createRoute({ getParentRoute: () => project, path: 'analytics', component: Outlet });
  const search = createRoute({ getParentRoute: () => analytics, path: 'search', component: () => <p>Search report</p> });
  const router = createRouter({
    routeTree: rootRoute.addChildren([project.addChildren([analytics.addChildren([search])])]),
    history: createMemoryHistory({ initialEntries: ['/app/projects/fixture/analytics/search'] }),
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      await router.load();
      root.render(<RouterProvider router={router} />);
    });
    const breadcrumb = host.querySelector('[data-slot="breadcrumb"]');
    expect(breadcrumb?.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(breadcrumb?.querySelector('[aria-current="page"]')?.textContent).toBe('analytics.tab.search');
    expect(breadcrumb?.querySelector('a[href="/app/projects/fixture"]')?.hasAttribute('aria-current')).toBe(false);
    expect(breadcrumb?.querySelector('a[href="/app/projects/fixture/analytics"]')?.hasAttribute('aria-current')).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
