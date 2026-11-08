// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ publicMeta: vi.fn(), refetch: vi.fn(), navigate: vi.fn(), send: vi.fn(), social: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => ({}) }),
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ history: { push: mocks.navigate, replace: mocks.navigate } }),
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/hooks/api/public', () => ({ useGetPublicMeta: mocks.publicMeta }));
vi.mock('@/hooks/api/query-options', () => ({ getPublicMetaQueryOptions: () => ({ queryKey: ['public', 'meta'] }) }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@/layouts/auth', () => ({ AuthLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/services/auth-client', () => ({ authClient: { emailOtp: { sendVerificationOtp: mocks.send } }, signIn: { social: mocks.social } }));
vi.mock('@/lib/invitations', () => ({ afterAuthDestination: () => null }));

import { Route } from './sign-up';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const SignUpPage = Route.options.component as unknown as ComponentType;

describe('sign-up availability', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('shows loading while the instance policy is unresolved', async () => {
    mocks.publicMeta.mockReturnValue({ isPending: true });
    await act(async () => root.render(<SignUpPage />));

    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.textContent).not.toContain('auth.legal.signupDisabled');
    expect(container.querySelector('form')).toBeNull();
  });

  it('offers retry after a metadata failure without claiming sign-ups are disabled', async () => {
    mocks.publicMeta.mockReturnValue({ isPending: false, isError: true, refetch: mocks.refetch });
    await act(async () => root.render(<SignUpPage />));

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain('auth.legal.signupDisabled');
    await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('respects a confirmed policy disabling public sign-up', async () => {
    mocks.publicMeta.mockReturnValue({ isPending: false, data: { signupDisabled: true, providers: { google: false } } });
    await act(async () => root.render(<SignUpPage />));

    expect(container.textContent).toContain('auth.legal.signupDisabled');
    expect(container.querySelector('form')).toBeNull();
  });

  it('opens the sign-up form once the enabled policy is loaded', async () => {
    mocks.publicMeta.mockReturnValue({ isPending: false, data: { signupDisabled: false, providers: { google: false } } });
    await act(async () => root.render(<SignUpPage />));

    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('explains the unticked terms instead of silently disabling the buttons', async () => {
    mocks.publicMeta.mockReturnValue({ isPending: false, data: { signupDisabled: false, providers: { google: true } } });
    await act(async () => root.render(<SignUpPage />));
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    const google = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('auth.google.signUp'));
    expect(submit?.disabled).toBe(false);
    expect(google?.disabled).toBe(false);

    await act(async () => google?.click());
    expect(mocks.social).not.toHaveBeenCalled();
    expect(container.querySelector('#agree-terms-error')?.textContent).toBe('auth.legal.agreeFirst');
    expect(container.querySelector('#agree-terms')?.getAttribute('aria-describedby')).toBe('agree-terms-error');
    expect(document.activeElement?.id).toBe('agree-terms');

    await act(async () => container.querySelector<HTMLInputElement>('#agree-terms')?.click());
    expect(container.querySelector('#agree-terms-error')).toBeNull();
  });
});
