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
  return {
    useT: () => (key: keyof typeof MESSAGE_IDS) => (mocks.locale === 'ar' ? ar : en)[MESSAGE_IDS[key]],
  };
});
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => mocks.search }),
  useNavigate: () => mocks.navigate,
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/hooks/api/public', () => ({
  useGetPublicMeta: () => ({ isPending: false, data: { signupDisabled: false, providers: { google: false } } }),
}));
vi.mock('@/layouts/auth', () => ({ AuthLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/services/auth-client', () => ({
  authClient: { emailOtp: { sendVerificationOtp: mocks.send, verifyEmail: mocks.verify }, signIn: { emailOtp: mocks.verify } },
  signIn: {},
  useSession: () => ({ data: null }),
}));
vi.mock('@/lib/invitations', () => ({ readPendingInvitation: () => null }));
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

  it('retains an unrelated server error instead of classifying it as a delivery outage', async () => {
    mocks.send.mockResolvedValue({ error: { code: 'TOO_MANY_REQUESTS', message: 'Please wait before requesting another code.' } });
    await render(signIn);
    await submit();
    expect(container.textContent).toContain('Please wait before requesting another code.');
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

  it('the installed OTP input completes after rendering the latest sixth digit', async () => {
    mocks.send.mockResolvedValue({ error: null });
    await render(signIn);
    await submit();
    for (const value of ['1', '12', '123', '1234', '12345']) await enter('[data-input-otp]', value);
    expect(mocks.verify).not.toHaveBeenCalled();
    await enter('[data-input-otp]', '123456');
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith({ email: 'synthetic@example.test', otp: '123456' });
  });
});
