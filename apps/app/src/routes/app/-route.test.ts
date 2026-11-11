import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Navigate: () => null,
  Outlet: () => null,
  redirect: (options: unknown) => ({ redirect: options }),
}));
vi.mock('@/components/app/command-palette', () => ({ CommandPaletteProvider: () => null }));
vi.mock('@/components/app/skip-to-content', () => ({ SkipToContent: () => null }));
vi.mock('@/components/app/support-access-banner', () => ({ SupportAccessBanner: () => null }));
vi.mock('@/components/app-providers', () => ({ AppProviders: () => null }));
vi.mock('@/components/page-loader', () => ({ PageLoader: () => null }));
vi.mock('@/functions/session', () => ({ getSessionFn: mocks.getSession }));
vi.mock('@/hooks/api/query-options', () => ({ projectsQueryOptions: () => ({ queryKey: ['projects'] }) }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@/integrations/tanstack-query/session-cache', () => ({ syncDashboardSession: vi.fn() }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: null }) }));
vi.mock('@/services/dashboard-session', () => ({ useDashboardSessionBoundary: () => true }));
vi.mock('@/stores/active-project', () => ({ ProjectProvider: () => null }));

import { Route } from './route';

type BeforeLoad = (context: { context: { queryClient: unknown }; location: { href: string } }) => Promise<unknown>;
const beforeLoad = (Route.options as unknown as { beforeLoad: BeforeLoad }).beforeLoad;
const open = (href: string) => beforeLoad({ context: { queryClient: {} }, location: { href } });

describe('/app guard for a signed-out visitor', () => {
  beforeEach(() => mocks.getSession.mockResolvedValue(null));

  it('sends them to sign in with the shared page, filters included, to come back to', async () => {
    const shared = '/app/projects/p1/ai?conversation=c9&language=ar&range=30d';
    await expect(open(shared)).rejects.toEqual({ redirect: { to: '/sign-in', search: { next: shared } } });
  });

  it('adds no return path for the dashboard home', async () => {
    await expect(open('/app')).rejects.toEqual({ redirect: { to: '/sign-in', search: {} } });
  });

  it('asks for an empty name and preserves the original destination', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'new-user', name: '  ' } });
    const original = '/app/projects/p1/ai?conversation=c9&language=ar#details';
    await expect(open(original)).rejects.toEqual({ redirect: { to: '/welcome/name', search: { redirect: original } } });
  });

  it('lets a signed-in visitor through', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1', name: 'Ada' } });
    await expect(open('/app/projects/p1')).resolves.toEqual({ routeSession: { user: { id: 'user-1', name: 'Ada' } } });
  });
});
