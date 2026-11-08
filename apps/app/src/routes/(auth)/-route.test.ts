import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Navigate: () => null,
  Outlet: () => null,
  redirect: (options: unknown) => ({ redirect: options }),
  useLocation: () => ({ searchStr: '' }),
}));
vi.mock('@/components/auth-providers', () => ({ AuthProviders: () => null }));
vi.mock('@/functions/session', () => ({ getSessionFn: mocks.getSession }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: null }) }));

import { Route } from './route';

type BeforeLoad = (context: { location: { pathname: string; searchStr: string } }) => Promise<void>;
const beforeLoad = (Route.options as unknown as { beforeLoad: BeforeLoad }).beforeLoad;
const OAUTH_SEARCH = '?oauth_request=signed-query';

describe('(auth) beforeLoad', () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
  });

  it('lets an MCP OAuth sign-in continue without waiting for the session lookup', async () => {
    mocks.getSession.mockReturnValue(new Promise(() => undefined));
    await expect(beforeLoad({ location: { pathname: '/sign-in', searchStr: OAUTH_SEARCH } })).resolves.toBeUndefined();
  });

  it('lets an MCP OAuth sign-in continue when the session lookup fails', async () => {
    mocks.getSession.mockRejectedValue(new Error('session endpoint down'));
    await expect(beforeLoad({ location: { pathname: '/sign-in', searchStr: OAUTH_SEARCH } })).resolves.toBeUndefined();
  });

  it('keeps an MCP OAuth sign-in on the page even when a session exists', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } });
    await expect(beforeLoad({ location: { pathname: '/sign-in', searchStr: OAUTH_SEARCH } })).resolves.toBeUndefined();
  });

  it('sends a signed-in visitor to the dashboard', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } });
    await expect(beforeLoad({ location: { pathname: '/sign-in', searchStr: '' } })).rejects.toEqual({ redirect: { to: '/app', search: {} } });
  });

  it('sends a signed-in visitor opening an invitation sign-in link to that invitation', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } });
    await expect(beforeLoad({ location: { pathname: '/sign-in', searchStr: '?invite=inv-1&email=a%40b.c' } })).rejects.toEqual({
      redirect: { href: '/accept-invite/inv-1' },
    });
  });

  it('keeps the first-publish intent when a signed-in visitor opens sign-up', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } });
    await expect(beforeLoad({ location: { pathname: '/sign-up', searchStr: '?intent=first-publish' } })).rejects.toEqual({
      redirect: { to: '/app', search: { firstPublish: true } },
    });
  });

  it('shows the sign-in page to a visitor without a session', async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(beforeLoad({ location: { pathname: '/sign-in', searchStr: '' } })).resolves.toBeUndefined();
  });
});
