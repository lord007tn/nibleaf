// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AnchorHTMLAttributes, ComponentType, ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { syncDashboardSession } from '@/integrations/tanstack-query/session-cache';
import { readPendingInvitation, setPendingInvitation } from '@/lib/invitations';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  invitation: vi.fn(),
  accept: vi.fn(),
  signOut: vi.fn(),
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  refetch: vi.fn(),
  prefetchRouteData: vi.fn(),
  projects: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/hooks/api', () => ({ useGetInvitationInfo: mocks.invitation, acceptInvitation: mocks.accept }));
vi.mock('@/hooks/api/query-options', () => ({
  getInvitationInfoQueryOptions: (invitationId: string) => ({ queryKey: ['public', 'invitations', invitationId] }),
  projectsQueryOptions: () => ({ queryKey: ['projects'], queryFn: mocks.projects }),
}));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: mocks.prefetchRouteData }));
vi.mock('@/services/auth-client', () => ({
  useSession: mocks.session,
  authClient: { signOut: mocks.signOut },
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess } }));
vi.mock('@/components/auth-providers', () => ({ AuthProviders: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/layouts/auth', () => ({ AuthLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({ options, useParams: () => ({ invitationId: 'invite-1' }) }),
  useNavigate: () => mocks.navigate,
  Link: ({ to, search: _search, children, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; search?: unknown }) => (
    <a
      href={to}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));

import { Route } from './accept-invite.$invitationId';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const PageComponent = Route.options.component as ComponentType;
const queryClient = new QueryClient();
const Page = () => (
  <QueryClientProvider client={queryClient}>
    <PageComponent />
  </QueryClientProvider>
);
const info = {
  orgRole: 'member',
  grants: [],
  email: 'recipient@example.com',
  organizationName: 'Example workspace',
  status: 'pending',
  expired: false,
};

describe('invitation recovery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.session.mockReturnValue({ data: { user: { id: 'recipient', email: info.email } }, isPending: false });
    mocks.invitation.mockReturnValue({
      data: info,
      error: null,
      isPending: false,
      isError: false,
      isSuccess: true,
      isFetching: false,
      refetch: mocks.refetch,
    });
    mocks.accept.mockResolvedValue({ organizationId: 'org-1', landing: { projectId: 'site-9' } });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.navigate.mockResolvedValue(undefined);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.localStorage.clear();
    queryClient.clear();
    vi.clearAllMocks();
  });

  const render = () => act(async () => root.render(<Page />));
  const button = () => container.querySelector<HTMLButtonElement>('button');
  /** The text a sighted user sees: Button keeps both labels in the layout and hides the inactive one. */
  const visibleLabel = () =>
    [...(button()?.querySelectorAll<HTMLElement>(':scope > span > span') ?? [])].find((label) => !label.classList.contains('invisible'))?.textContent;

  it('prefetches the invitation in the route loader', () => {
    const queryClient = {};
    const loader = (Route.options as unknown as { loader: (args: unknown) => void }).loader;
    loader({ context: { queryClient }, params: { invitationId: 'invite-1' } });
    expect(mocks.prefetchRouteData).toHaveBeenCalledExactlyOnceWith(queryClient, { queryKey: ['public', 'invitations', 'invite-1'] });
  });

  it('shows a busy skeleton, not loading text, while the invitation loads', async () => {
    mocks.invitation.mockReturnValue({
      data: undefined,
      error: null,
      isPending: true,
      isError: false,
      isSuccess: false,
      isFetching: true,
      refetch: mocks.refetch,
    });
    await render();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('common.loading');
    expect(container.querySelector('button')).toBeNull();
  });

  it('signs out a mismatched account and keeps the invitation for the correct sign-in', async () => {
    mocks.session.mockReturnValue({ data: { user: { email: 'wrong@example.com' } }, isPending: false });
    await render();
    expect(container.textContent).toContain('auth.invite.wrongAccount');
    expect(button()?.textContent).toBe('auth.invite.switchAccount');
    await act(async () => button()?.click());
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(readPendingInvitation()).toBe('invite-1');
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/sign-in', search: { invite: 'invite-1', email: info.email } });
  });

  it.each(['response', 'network'])('recovers when wrong-account sign-out fails with a %s error', async (failure) => {
    mocks.session.mockReturnValue({ data: { user: { email: 'wrong@example.com' } }, isPending: false });
    if (failure === 'response') mocks.signOut.mockResolvedValueOnce({ error: { message: 'Private provider detail' } });
    else mocks.signOut.mockRejectedValueOnce(new Error('Private provider detail'));
    await render();
    await act(async () => button()?.click());
    expect(container.textContent).toContain('auth.invite.switchAccountError');
    expect(container.textContent).not.toContain('Private provider detail');
    expect(button()?.disabled).toBe(false);
    expect(button()?.textContent).toBe('auth.invite.switchAccount');
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.accept).not.toHaveBeenCalled();
    // A retry can complete without refreshing or losing the invitation.
    await act(async () => button()?.click());
    expect(mocks.signOut).toHaveBeenCalledTimes(2);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/sign-in', search: { invite: 'invite-1', email: info.email } });
  });

  it('releases acceptance loading after a network rejection and allows a successful retry', async () => {
    let rejectRequest: ((error: Error) => void) | undefined;
    mocks.accept.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject;
        }),
    );
    setPendingInvitation('invite-1');
    await render();
    await act(async () => button()?.click());
    expect(button()?.disabled).toBe(true);
    expect(button()?.getAttribute('aria-busy')).toBe('true');
    expect(visibleLabel()).toBe('auth.invite.accepting');
    await act(async () => rejectRequest?.(new Error('Network disconnected')));
    expect(container.textContent).toContain('auth.invite.error');
    expect(container.textContent).not.toContain('Network disconnected');
    expect(button()?.disabled).toBe(false);
    expect(button()?.getAttribute('aria-busy')).toBeNull();
    expect(visibleLabel()).toBe('auth.invite.accept');
    expect(readPendingInvitation()).toBe('invite-1');
    await act(async () => button()?.click());
    expect(mocks.accept).toHaveBeenCalledTimes(2);
    expect(mocks.accept).toHaveBeenLastCalledWith('invite-1');
    expect(readPendingInvitation()).toBeNull();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('auth.invite.acceptedToast');
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/projects/$projectId', params: { projectId: 'site-9' } });
  });

  it('offers retry for an invitation load failure instead of calling it missing', async () => {
    mocks.invitation.mockReturnValue({
      data: undefined,
      error: new Error('Network disconnected'),
      isPending: false,
      isError: true,
      isSuccess: false,
      isFetching: false,
      refetch: mocks.refetch,
    });
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('error.unexpected');
    expect(container.textContent).not.toContain('auth.invite.notFound');
    expect(button()?.textContent).toBe('error.tryAgain');
    await act(async () => button()?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it.each(['invite-1', 'other-invitation'])('shows an explicit 404 and clears only its matching pending invitation (%s)', async (storedId) => {
    setPendingInvitation(storedId);
    mocks.invitation.mockReturnValue({
      data: undefined,
      error: new ApiResponseError('Invitation does not exist', 404),
      isPending: false,
      isError: true,
      isSuccess: false,
      isFetching: false,
      refetch: mocks.refetch,
    });
    await render();
    expect(container.textContent).toContain('auth.invite.notFound');
    expect(button()).toBeNull();
    expect(mocks.refetch).not.toHaveBeenCalled();
    expect(readPendingInvitation()).toBe(storedId === 'invite-1' ? null : storedId);
  });

  it.each(['invite-1', 'other-invitation'])(
    'clears only the matching pending invitation when it expires during acceptance (%s)',
    async (storedId) => {
      setPendingInvitation(storedId);
      mocks.accept.mockRejectedValueOnce(new ApiResponseError('Invalid invitation', 404, 'database:not_found'));

      await render();
      await act(async () => button()?.click());
      expect(container.textContent).toContain('auth.invite.error');
      expect(button()?.disabled).toBe(false);
      expect(readPendingInvitation()).toBe(storedId === 'invite-1' ? null : storedId);
      expect(mocks.navigate).not.toHaveBeenCalled();
    },
  );

  it('clears a stale pending invitation when the signed-in user skips joining', async () => {
    setPendingInvitation('old-invitation');
    await render();
    const skip = [...container.querySelectorAll<HTMLAnchorElement>('a')].find((link) => link.textContent === 'auth.invite.skip');
    expect(skip?.getAttribute('href')).toBe('/app');
    await act(async () => skip?.click());
    expect(readPendingInvitation()).toBeNull();
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it.each(['invite-1', 'other-invitation'])('clears an expired stored invitation only when it matches the current link (%s)', async (storedId) => {
    setPendingInvitation(storedId);
    mocks.invitation.mockReturnValue({
      data: { ...info, expired: true },
      error: null,
      isPending: false,
      isError: false,
      isSuccess: true,
      isFetching: false,
      refetch: mocks.refetch,
    });
    await render();
    expect(container.textContent).toContain('auth.invite.expiredError');
    expect(button()).toBeNull();
    expect(readPendingInvitation()).toBe(storedId === 'invite-1' ? null : storedId);
  });

  it('opens the site the user just joined, selected, instead of the site the dashboard had open', async () => {
    // The dashboard last belonged to another account (the user chose "Log in with the invited account").
    syncDashboardSession(queryClient, 'previous-account');
    window.localStorage.setItem('nibleaf.activeProjectId', 'own-site');
    mocks.accept.mockResolvedValueOnce({ organizationId: 'org-joined', landing: { projectId: 'joined-site' } });
    mocks.projects.mockResolvedValue([
      { id: 'own-site', organizationId: 'org-own' },
      { id: 'joined-site', organizationId: 'org-joined' },
    ]);
    await render();
    await act(async () => button()?.click());
    expect(mocks.projects).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('nibleaf.activeProjectId')).toBe('joined-site');
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/projects/$projectId', params: { projectId: 'joined-site' } });
    // What /app's session check does next must keep that selection.
    syncDashboardSession(queryClient, 'recipient');
    expect(window.localStorage.getItem('nibleaf.activeProjectId')).toBe('joined-site');
  });

  it('says an already-accepted invitation was used instead of offering to accept it again', async () => {
    setPendingInvitation('invite-1');
    mocks.invitation.mockReturnValue({
      data: { ...info, status: 'accepted' },
      error: null,
      isPending: false,
      isError: false,
      isSuccess: true,
      isFetching: false,
      refetch: mocks.refetch,
    });
    await render();
    expect(container.textContent).toContain('auth.invite.alreadyUsed');
    expect(container.textContent).not.toContain('auth.invite.accept');
    expect(button()).toBeNull();
    expect(readPendingInvitation()).toBeNull();
    expect(mocks.accept).not.toHaveBeenCalled();
  });
});
