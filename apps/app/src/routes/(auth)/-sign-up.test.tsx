// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ publicMeta: vi.fn(), refetch: vi.fn(), navigate: vi.fn(), send: vi.fn(), social: vi.fn(), verify: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => {
  const t = (key: string) => key;
  return { useT: () => t, useLocale: () => ({ t, locale: 'en' }) };
});
// The auth surfaces translate through AUTH_MESSAGES (MKT-001); give them the
// same translator and locale as the @nibleaf/i18n/react mock above.
vi.mock('@/lib/auth-messages', async () => {
  const react = (await import('@nibleaf/i18n/react')) as unknown as {
    useT?: () => (key: string, variables?: Record<string, string | number>) => string;
    useLocale?: () => Record<string, unknown>;
  };
  // Plain names: the mocks are read per render, not called as hooks here. A
  // mock without one of them throws on access, hence the `in` checks.
  const readT = 'useT' in react ? react.useT : undefined;
  const readLocale = 'useLocale' in react ? react.useLocale : undefined;
  const authLocale = (): Record<string, unknown> => ({ locale: 'en', setLocale: () => undefined, ...(readLocale ? readLocale() : { t: readT?.() }) });
  return { useAuthLocale: authLocale, useAuthT: () => (readT ? readT() : authLocale().t) };
});

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => ({}), useLoaderData: () => null }),
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ history: { push: mocks.navigate, replace: mocks.navigate } }),
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/hooks/api/public', () => ({ useGetPublicMeta: mocks.publicMeta }));
vi.mock('@/hooks/api/query-options', () => ({ getPublicMetaQueryOptions: () => ({ queryKey: ['public', 'meta'] }) }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ loadRouteData: vi.fn() }));
vi.mock('@/layouts/auth', () => ({ AuthLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/services/auth-client', () => ({
  authClient: { signIn: { emailOtp: mocks.verify }, emailOtp: { sendVerificationOtp: mocks.send } },
  signIn: { social: mocks.social },
}));
vi.mock('@/lib/invitations', () => ({ afterAuthDestination: () => null }));

import { Route as SignInRoute } from './sign-in';
import { Route } from './sign-up';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
// input-otp uses hit testing when its real input receives focus; jsdom has no layout.
Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
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

  it.each([
    ['sign-up', Route.options.component],
    ['sign-in', SignInRoute.options.component],
  ])('shows the same notice at Google and email actions on %s, with no checkbox', async (_name, component) => {
    mocks.publicMeta.mockReturnValue({ isPending: false, data: { signupDisabled: false, providers: { google: true } } });
    mocks.social.mockResolvedValue({});
    const Page = component as unknown as ComponentType;
    await act(async () => root.render(<Page />));
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    const notices = [...container.querySelectorAll('p')].filter((p) => p.textContent?.includes('auth.legal.continuePrefix'));
    expect(notices).toHaveLength(2);
    for (const notice of notices) {
      expect(notice.querySelector('a[href="/terms"]')).not.toBeNull();
      expect(notice.querySelector('a[href="/privacy"]')).not.toBeNull();
    }
    const google = container.querySelector<HTMLButtonElement>('button');
    await act(async () => google?.click());
    expect(mocks.social).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google', additionalData: { acceptTerms: true } }));
  });

  it.each([
    ['sign-up', Route.options.component],
    ['sign-in', SignInRoute.options.component],
  ])('sends explicit consent at OTP verification on %s while showing the notice', async (_name, component) => {
    mocks.publicMeta.mockReturnValue({ isPending: false, data: { signupDisabled: false, providers: { google: false } } });
    mocks.send.mockResolvedValue({});
    mocks.verify.mockResolvedValue({ data: {} });
    const Page = component as unknown as ComponentType;
    await act(async () => root.render(<Page />));
    const setInput = async (selector: string, value: string) =>
      act(async () => {
        const input = container.querySelector<HTMLInputElement>(selector);
        if (!input) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    await setInput('#email', 'ada@example.test');
    await setInput('#name', 'Ada');
    const submit = () =>
      act(async () => {
        container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    await submit();
    expect(mocks.send).toHaveBeenCalledWith({ email: 'ada@example.test', type: 'sign-in' }, expect.anything());
    expect(container.querySelector('form')?.textContent).toContain('auth.legal.continuePrefix');
    await setInput('#otp', '123456');
    // InputOTP may auto-submit on completion; form submission uses the same path.
    if (!mocks.verify.mock.calls.length) await submit();
    expect(mocks.verify).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ada@example.test', otp: '123456', acceptTerms: true }),
      expect.anything(),
    );
  });
});
