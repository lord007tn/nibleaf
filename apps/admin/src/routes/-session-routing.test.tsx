// @vitest-environment jsdom

import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  session: { data: { user: { id: 'synthetic-admin' } } as object | null, isPending: false },
  overview: { isPending: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  serverSession: vi.fn(async () => null),
}));

vi.mock('@/functions/session', () => ({ getSessionFn: state.serverSession }));
vi.mock('@/services/auth-client', () => ({ useSession: () => state.session, signOut: vi.fn() }));
vi.mock('@/hooks/api/queries', () => ({
  useAdminOverview: () => state.overview,
  AdminApiError: class extends Error {
    readonly status: number;

    constructor(status: number) {
      super('Synthetic admin response');
      this.status = status;
    }
  },
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/components/admin-sidebar', () => ({ AdminSidebar: () => <aside>Admin navigation</aside> }));
vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/components/page-loader', () => ({ PageLoader: () => <div role="status">Loading session</div> }));
vi.mock('@nibleaf/design-system/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => null,
}));

import { AdminApiError } from '@/hooks/api/queries';
import { Route as AuthRoute } from './(auth)/route';
import { Route as DashboardRoute } from './(dashboard)/route';

describe('admin session routing', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.scrollTo = vi.fn();
    state.session = { data: { user: { id: 'synthetic-admin' } }, isPending: false };
    state.overview = { isPending: false, isError: false, error: null, refetch: vi.fn() };
    state.serverSession.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function routerAt(path: string) {
    const rootRoute = createRootRoute({ component: Outlet });
    const auth = AuthRoute.update({ id: '/(auth)', getParentRoute: () => rootRoute } as never);
    const dashboard = DashboardRoute.update({ id: '/(dashboard)', getParentRoute: () => rootRoute } as never);
    const login = createRoute({ getParentRoute: () => auth, path: '/sign-in', component: () => <input aria-label="Verification code" /> });
    const index = createRoute({ getParentRoute: () => dashboard, path: '/', component: () => <h1>Admin overview</h1> });
    return createRouter({
      routeTree: rootRoute.addChildren([auth.addChildren([login]), dashboard.addChildren([index])]),
      history: createMemoryHistory({ initialEntries: [path] }),
      defaultPendingMinMs: 0,
    });
  }

  it('keeps a shared-origin signed-in user on the dashboard when admin-origin SSR has no cookie', async () => {
    const router = routerAt('/');
    await router.load();
    expect(router.state.location.pathname).toBe('/');
    await act(async () => root.render(<RouterProvider router={router} />));
    expect(container.textContent).toContain('Admin overview');
  });

  it('waits for the browser session before rendering protected navigation', async () => {
    state.session = { data: null, isPending: true };
    const router = routerAt('/');
    await router.load();
    await act(async () => root.render(<RouterProvider router={router} />));
    expect(container.textContent).toContain('Loading session');
    expect(container.textContent).not.toContain('Admin navigation');
  });

  it('routes a signed-out browser to sign-in', async () => {
    state.session = { data: null, isPending: false };
    const router = routerAt('/');
    await router.load();
    await act(async () => root.render(<RouterProvider router={router} />));
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(container.querySelector('input')).not.toBeNull();
  });

  it('routes a signed-in browser from sign-in to the protected overview', async () => {
    const router = routerAt('/sign-in');
    await router.load();
    await act(async () => root.render(<RouterProvider router={router} />));
    expect(router.state.location.pathname).toBe('/');
    expect(container.textContent).toContain('Admin overview');
  });

  it('keeps the OTP input mounted during session revalidation', async () => {
    state.session = { data: null, isPending: false };
    const router = routerAt('/sign-in');
    await router.load();
    await act(async () => root.render(<RouterProvider router={router} />));
    const input = container.querySelector('input');
    state.session = { data: null, isPending: true };
    await act(async () => root.render(<RouterProvider router={router} />));
    expect(container.querySelector('input')).toBe(input);
  });

  it.each([401, 403])('shows unauthorized after a fresh %s admin response', async (status) => {
    state.overview = { ...state.overview, isError: true, error: new AdminApiError(status) };
    const router = routerAt('/');
    await router.load();
    await act(async () => root.render(<RouterProvider router={router} />));
    expect(container.textContent).toContain('admin.auth.unauthorized');
    expect(container.textContent).not.toContain('Admin navigation');
  });
});
