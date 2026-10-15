// @vitest-environment jsdom
import type { AnchorHTMLAttributes, ComponentType, ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { readPendingInvitation, setPendingInvitation } from '@/lib/invitations';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  invitation: vi.fn(),
  accept: vi.fn(),
  signOut: vi.fn(),
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/hooks/api', () => ({ useGetInvitationInfo: mocks.invitation }));
vi.mock('@/services/auth-client', () => ({
  useSession: mocks.session,
  authClient: { organization: { acceptInvitation: mocks.accept }, signOut: mocks.signOut },
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
const Page = Route.options.component as ComponentType;
const info = { email: 'recipient@example.com', organizationName: 'Example workspace', expired: false };

describe('invitation recovery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.session.mockReturnValue({ data: { user: { email: info.email } }, isPending: false });
    mocks.invitation.mockReturnValue({
      data: info,
      error: null,
      isPending: false,
      isError: false,
      isSuccess: true,
      isFetching: false,
      refetch: mocks.refetch,
    });
    mocks.accept.mockResolvedValue({ error: null });
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
    vi.clearAllMocks();
  });

  const render = () => act(async () => root.render(<Page />));
  const button = () => container.querySelector<HTMLButtonElement>('button');

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
    expect(button()?.textContent).toBe('auth.invite.accepting');
    await act(async () => rejectRequest?.(new Error('Network disconnected')));
    expect(container.textContent).toContain('auth.invite.error');
    expect(container.textContent).not.toContain('Network disconnected');
    expect(button()?.disabled).toBe(false);
    expect(button()?.textContent).toBe('auth.invite.accept');
    expect(readPendingInvitation()).toBe('invite-1');
    await act(async () => button()?.click());
    expect(mocks.accept).toHaveBeenCalledTimes(2);
    expect(mocks.accept).toHaveBeenLastCalledWith({ invitationId: 'invite-1' });
    expect(readPendingInvitation()).toBeNull();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('auth.invite.acceptedToast');
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app' });
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
      mocks.accept.mockResolvedValueOnce({ error: { code: 'INVITATION_EXPIRED' } });
      await render();
      await act(async () => button()?.click());
      expect(container.textContent).toContain('auth.invite.expiredError');
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
});
