// @vitest-environment jsdom
import type { ComponentType, ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPendingInvitation } from '@/lib/invitations';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  location: { pathname: '/sign-up', searchStr: '' },
  replace: vi.fn(),
  navigateTo: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Navigate: (props: unknown) => {
    mocks.navigateTo(props);
    return null;
  },
  Outlet: () => <p>auth form</p>,
  redirect: (options: unknown) => ({ redirect: options }),
  useLocation: () => mocks.location,
  useRouter: () => ({ history: { replace: mocks.replace } }),
}));
vi.mock('@/components/auth-providers', () => ({ AuthProviders: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/functions/session', () => ({ getSessionFn: vi.fn() }));
vi.mock('@/services/auth-client', () => ({ useSession: mocks.session }));

import { Route } from './route';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const Guard = Route.options.component as ComponentType;

// The race this guards against: the sign-up/in page's own redirect to the
// invitation waits for the accept page's loader, while this guard re-renders as
// soon as the session refreshes. It used to send everyone to /app, so a new
// member landed on an empty dashboard and the invitation was dropped.
describe('(auth) guard for a visitor who has just signed in', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.session.mockReturnValue({ data: { user: { id: 'new-member' } } });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  const render = () => act(async () => root.render(<Guard />));

  it('continues to the invitation named in the URL, not the dashboard', async () => {
    mocks.location = { pathname: '/sign-up', searchStr: '?invite=inv-1&email=new%40example.com' };
    await render();
    expect(mocks.replace).toHaveBeenCalledWith('/accept-invite/inv-1');
    expect(mocks.navigateTo).not.toHaveBeenCalled();
  });

  it('continues to the invitation remembered before sign-in when the URL no longer names it', async () => {
    setPendingInvitation('inv-2');
    mocks.location = { pathname: '/sign-in', searchStr: '' };
    await render();
    expect(mocks.replace).toHaveBeenCalledWith('/accept-invite/inv-2');
    expect(mocks.navigateTo).not.toHaveBeenCalled();
  });

  it('stays out of the way once the sign-up page is already opening the invitation', async () => {
    // Mid-transition the router already reports the next location, with no ?invite= and,
    // for a link opened straight on sign-up, nothing remembered.
    mocks.location = { pathname: '/accept-invite/inv-1', searchStr: '' };
    await render();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.navigateTo).not.toHaveBeenCalled();
  });

  it('still sends other signed-in visitors to the dashboard', async () => {
    mocks.location = { pathname: '/sign-in', searchStr: '' };
    await render();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.navigateTo).toHaveBeenCalledWith({ to: '/app', search: {} });
  });

  it('keeps showing the form while nobody is signed in', async () => {
    mocks.session.mockReturnValue({ data: null });
    mocks.location = { pathname: '/sign-up', searchStr: '?invite=inv-1' };
    await render();
    expect(container.textContent).toBe('auth form');
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
