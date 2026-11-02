// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ publicMeta: vi.fn(), refetch: vi.fn(), navigate: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => ({}) }),
  useNavigate: () => mocks.navigate,
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/hooks/api/public', () => ({ useGetPublicMeta: mocks.publicMeta }));
vi.mock('@/layouts/auth', () => ({ AuthLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/services/auth-client', () => ({ authClient: {}, signIn: {} }));
vi.mock('@/lib/invitations', () => ({ readPendingInvitation: () => null }));

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
});
