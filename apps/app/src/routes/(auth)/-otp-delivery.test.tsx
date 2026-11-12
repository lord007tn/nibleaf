// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  locale: 'ar',
  send: vi.fn(),
  verify: vi.fn(),
  navigate: vi.fn(),
  search: { email: 'synthetic@example.test' },
}));

vi.mock('@nibleaf/i18n/react', async () => {
  const [{ default: ar }, { default: en }, { MESSAGE_IDS }] = await Promise.all([
    import('../../../../../packages/i18n/messages/ar.json'),
    import('../../../../../packages/i18n/messages/en.json'),
    import('../../../../../packages/i18n/src/message-ids'),
  ]);
  const t = (key: keyof typeof MESSAGE_IDS, variables?: Record<string, string | number>) =>
    String((mocks.locale === 'ar' ? ar : en)[MESSAGE_IDS[key] as keyof typeof en]).replace(/\{(\w+)\}/g, (_, name) =>
      String(variables?.[name] ?? ''),
    );
  return { useT: () => t, useLocale: () => ({ t, locale: mocks.locale }) };
});
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => mocks.search, useLoaderData: () => null }),
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ history: { push: mocks.navigate, replace: mocks.navigate } }),
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/hooks/api/public', () => ({
  useGetPublicMeta: () => ({ isPending: false, data: { signupDisabled: false, providers: { google: false } } }),
}));
vi.mock('@/hooks/api/query-options', () => ({ getPublicMetaQueryOptions: () => ({ queryKey: ['public', 'meta'] }) }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ loadRouteData: vi.fn() }));
vi.mock('@/layouts/auth', () => ({ AuthLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/services/auth-client', () => ({
  authClient: { emailOtp: { sendVerificationOtp: mocks.send, verifyEmail: mocks.verify }, signIn: { emailOtp: mocks.verify } },
  signIn: {},
  useSession: () => ({ data: null }),
}));
vi.mock('@/lib/invitations', () => ({ afterAuthDestination: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

import { Route as SignInRoute } from './sign-in';
import { Route as SignUpRoute } from './sign-up';
import { Route as VerifyEmailRoute } from './verify-email';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
// input-otp checks password-manager badge geometry; jsdom has no hit testing.
document.elementFromPoint = () => null;
const signIn = SignInRoute.options.component as unknown as ComponentType;
const signUp = SignUpRoute.options.component as unknown as ComponentType;
const verifyEmail = VerifyEmailRoute.options.component as unknown as ComponentType;
const unavailable = { code: 'AUTH_EMAIL_UNAVAILABLE', message: 'Unable to send a code. Please try again shortly.', status: 503 };

describe('required auth email delivery feedback', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.locale = 'ar';
    mocks.send.mockResolvedValue({ error: unavailable });
    mocks.verify.mockResolvedValue({ error: { code: 'INVALID_OTP' } });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function render(Page: ComponentType) {
    await act(async () => root.render(<Page />));
  }

  async function enter(selector: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`Missing input: ${selector}`);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function submit() {
    if (container.querySelector('#name')) await enter('#name', 'Synthetic QA');
    const terms = container.querySelector<HTMLInputElement>('#agree-terms');
    if (terms && !terms.checked) await act(async () => terms.click());
    const button = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(button?.disabled).toBe(false);
    await act(async () => button?.click());
  }

  it.each([
    ['sign-in', signIn],
    ['sign-up', signUp],
  ])('%s localizes the unavailable-delivery code and preserves the request form', async (_name, Page) => {
    await render(Page);
    await submit();
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('تعذّر إرسال رمز لمرة واحدة');
    expect(container.textContent).not.toContain(unavailable.message);
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(container.querySelector('[data-input-otp]')).toBeNull();
  });

  it('shows a localized rate-limit message instead of the English server text', async () => {
    mocks.send.mockResolvedValue({ error: { code: 'TOO_MANY_REQUESTS', message: 'Please wait before requesting another code.' } });
    await render(signIn);
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('محاولات كثيرة جدًا. انتظر دقيقة ثم حاول مجددًا.');
    expect(container.textContent).not.toContain('Please wait before requesting another code.');
  });

  it('tells a suspended account to contact support instead of calling a valid code invalid', async () => {
    mocks.send.mockResolvedValue({ error: null });
    mocks.verify.mockResolvedValue({
      error: { status: 403, message: 'This account has been suspended. Contact support@nibleaf.com if you believe this is a mistake.' },
    });
    await render(signIn);
    await submit();
    await enter('[data-input-otp]', '123456');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('تم إيقاف هذا الحساب. تواصل مع support@nibleaf.com إن كنت تعتقد أن ذلك خطأ.');
  });

  it('does not call the code invalid when the request never reached the server', async () => {
    mocks.send.mockResolvedValue({ error: null });
    mocks.verify.mockRejectedValue(new TypeError('Failed to fetch'));
    await render(signIn);
    await submit();
    await enter('[data-input-otp]', '123456');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('حدث خطأ ما. تحقّق من اتصالك ثم حاول مجددًا.');
  });

  it('uses the existing English translation when the interface is English', async () => {
    mocks.locale = 'en';
    await render(signIn);
    await submit();
    expect(container.textContent).toContain('Could not send a one-time code');
    expect(container.textContent).not.toContain(unavailable.message);
  });

  it('verification resend already localizes an unavailable-delivery error', async () => {
    await render(verifyEmail);
    await act(async () => container.querySelector<HTMLButtonElement>('button[type="button"]')?.click());
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('تعذّر إرسال الرمز. حاول إرسال رمز جديد.');
    expect(container.textContent).not.toContain(unavailable.message);
  });

  it.each([
    ['sign-in', signIn],
    ['sign-up', signUp],
  ])('%s recovers from consumed-code consent errors', async (_label, Page) => {
    mocks.locale = 'en';
    mocks.send.mockResolvedValue({ error: null });
    mocks.verify.mockResolvedValue({ error: { code: 'TERMS_REQUIRED' } });
    await render(Page);
    await submit();
    await enter('[data-input-otp]', '123456');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Accept the terms, then request a new code.');
    expect(container.querySelector('[data-input-otp]')).toBeNull();
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
  });

  it.each([
    ['sign-in', signIn],
    ['sign-up', signUp],
  ])('%s explains a verified code on a closed instance', async (_label, Page) => {
    mocks.locale = 'en';
    mocks.send.mockResolvedValue({ error: null });
    mocks.verify.mockResolvedValue({ error: { code: 'SIGNUP_CLOSED' } });
    await render(Page);
    await submit();
    await enter('[data-input-otp]', '123456');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'New account registration is closed on this instance. Contact your administrator for access.',
    );
  });

  it('the installed OTP input completes after rendering the latest sixth digit', async () => {
    mocks.send.mockResolvedValue({ error: null });
    await render(signIn);
    await submit();
    for (const value of ['1', '12', '123', '1234', '12345']) await enter('[data-input-otp]', value);
    expect(mocks.verify).not.toHaveBeenCalled();
    await enter('[data-input-otp]', '123456');
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith({ email: 'synthetic@example.test', otp: '123456', acceptTerms: true }, expect.anything());
  });
});
