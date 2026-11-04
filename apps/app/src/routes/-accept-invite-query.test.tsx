// @vitest-environment jsdom
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentType, ReactElement, ReactNode } from 'react';
import { act, cloneElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPendingInvitation, setPendingInvitation } from '@/lib/invitations';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  invitationRequest: vi.fn(),
  accept: vi.fn(),
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@nibleaf/design-system/components/ui/button', () => ({
  Button: ({
    children,
    render,
    nativeButton: _nativeButton,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { render?: ReactElement; nativeButton?: boolean }) =>
    render ? (
      cloneElement(render, undefined, children)
    ) : (
      <button type="button" {...props}>
        {children}
      </button>
    ),
}));
// Keep the real public query hook without importing unrelated dashboard/server hooks.
vi.mock('@/hooks/api', () => import('@/hooks/api/public'));
vi.mock('@/services/api', () => ({
  api: { public: { invitations: { ':id': { $get: mocks.invitationRequest } } } },
}));
vi.mock('@/services/auth-client', () => ({
  useSession: mocks.session,
  authClient: { organization: { acceptInvitation: mocks.accept } },
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess } }));
vi.mock('@/components/localized-product-providers', () => ({
  LocalizedProductProviders: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/layouts/auth', () => ({ AuthLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({ options, useParams: () => ({ invitationId: 'invite-1' }) }),
  useNavigate: () => mocks.navigate,
  useRouterState: () => '/accept-invite/invite-1',
  Link: ({ to, search, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; search?: Record<string, string> }) => (
    <a href={`${to}${search ? `?${new URLSearchParams(search)}` : ''}`} {...props}>
      {children}
    </a>
  ),
}));

import { Route } from './accept-invite.$invitationId';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const Page = Route.options.component as ComponentType;
const info = { email: 'recipient@example.com', organizationName: 'Example workspace', expired: false };

describe('invitation route query integration', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.session.mockReturnValue({ data: null, isPending: false });
    mocks.invitationRequest.mockImplementation(async () => Response.json({ data: info }));
    mocks.accept.mockResolvedValue({ error: null });
    mocks.navigate.mockResolvedValue(undefined);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.localStorage.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  const render = async () => {
    // Mount the route directly: its production tree must supply the QueryClient.
    await act(async () => root.render(<Page />));
    // Flush query notifications without advancing its cache garbage-collection timer.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  };

  it('loads a direct invitation link for a signed-out recipient and preserves the sign-in destination', async () => {
    await render();

    expect(mocks.invitationRequest).toHaveBeenCalledOnce();
    expect(mocks.invitationRequest).toHaveBeenCalledWith({ param: { id: 'invite-1' } });
    expect(container.textContent).toContain('auth.invite.signInPrompt');
    expect(readPendingInvitation()).toBe('invite-1');
    for (const destination of ['/sign-up', '/sign-in']) {
      const link = container.querySelector<HTMLAnchorElement>(`a[href^="${destination}?"]`);
      expect(link).not.toBeNull();
      const url = new URL(link?.href ?? '', window.location.origin);
      expect(url.searchParams.get('invite')).toBe('invite-1');
      expect(url.searchParams.get('email')).toBe(info.email);
    }
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it('loads and accepts the invitation for the matching signed-in recipient', async () => {
    mocks.session.mockReturnValue({ data: { user: { email: info.email } }, isPending: false });
    setPendingInvitation('invite-1');
    await render();

    const acceptButton = container.querySelector<HTMLButtonElement>('button');
    expect(acceptButton?.textContent).toBe('auth.invite.accept');
    await act(async () => acceptButton?.click());

    expect(mocks.accept).toHaveBeenCalledWith({ invitationId: 'invite-1' });
    expect(readPendingInvitation()).toBeNull();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('auth.invite.acceptedToast');
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app' });
  });

  it('shows an expired invitation after loading its metadata and clears its saved destination', async () => {
    mocks.invitationRequest.mockImplementation(async () => Response.json({ data: { ...info, expired: true } }));
    setPendingInvitation('invite-1');
    await render();

    expect(container.textContent).toContain('auth.invite.expiredError');
    expect(container.querySelector('button')).toBeNull();
    expect(readPendingInvitation()).toBeNull();
    expect(mocks.accept).not.toHaveBeenCalled();
  });
});
