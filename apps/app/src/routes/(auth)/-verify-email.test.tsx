// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  checkLink: vi.fn(),
  send: vi.fn(),
  verify: vi.fn(),
  navigate: vi.fn(),
  push: vi.fn(),
  search: {} as Record<string, string | undefined>,
}));

vi.mock('@nibleaf/i18n/react', async () => {
  const [{ default: ar }, { default: en }, { MESSAGE_IDS }] = await Promise.all([
    import('../../../../../packages/i18n/messages/ar.json'),
    import('../../../../../packages/i18n/messages/en.json'),
    import('../../../../../packages/i18n/src/message-ids'),
  ]);
  // One function for every render, like the real hook's memoized translator.
  const t = (key: keyof typeof MESSAGE_IDS, variables?: Record<string, string>) =>
    String((mocks.locale === 'ar' ? ar : en)[MESSAGE_IDS[key] as keyof typeof en]).replace(/\{(\w+)\}/g, (_, name) => variables?.[name] ?? '');
  return { useT: () => t };
});
// Stable like the real router, so the link check runs once.
const router = { history: { push: (path: string) => mocks.push(path) } };
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => mocks.search }),
  useNavigate: () => mocks.navigate,
  useRouter: () => router,
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/layouts/auth', () => ({ AuthLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/services/auth-client', () => ({
  authClient: { verifyEmail: mocks.checkLink, emailOtp: { sendVerificationOtp: mocks.send, verifyEmail: mocks.verify } },
  useSession: () => ({ data: null }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

import { Route } from './verify-email';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
// input-otp checks password-manager badge geometry; jsdom has no hit testing.
document.elementFromPoint = () => null;
const VerifyEmail = Route.options.component as unknown as ComponentType;

describe('verify email recovery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.locale = 'en';
    mocks.search = {};
    mocks.checkLink.mockResolvedValue({ error: { code: 'INVALID_TOKEN' } });
    mocks.send.mockResolvedValue({ error: null });
    mocks.verify.mockResolvedValue({ error: null });
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

  const render = () => act(async () => root.render(<VerifyEmail />));
  // A loading-capable button also holds its loading text, so match on the label it starts with.
  const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.startsWith(label));
  async function enter(selector: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`Missing input: ${selector}`);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('turns a failed link with a known address into a code form, and the resent code verifies', async () => {
    mocks.search = { token: 'expired', email: 'writer@example.test', invite: 'inv-1' };
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('invalid or has expired');
    expect(container.querySelector('[data-input-otp]')).not.toBeNull();

    await act(async () => button('Resend code')?.click());
    expect(mocks.send).toHaveBeenCalledWith({ email: 'writer@example.test', type: 'email-verification' });
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await enter('[data-input-otp]', '123456');
    expect(mocks.verify).toHaveBeenCalledWith({ email: 'writer@example.test', otp: '123456' });
    // The invitation survives the recovery.
    expect(mocks.push).toHaveBeenCalledWith('/accept-invite/inv-1');
  });

  it('asks for the address when neither the link nor a session has one, then takes the code', async () => {
    mocks.locale = 'ar';
    mocks.search = { token: 'expired' };
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'رابط التحقق هذا غير صالح أو انتهت صلاحيته. أدخل بريدك الإلكتروني لتحصل على رمز جديد.',
    );
    expect(container.querySelector('[data-input-otp]')).toBeNull();

    await enter('#verification-email', ' Writer@Example.test ');
    await act(async () => button('إرسال رمز جديد')?.click());
    expect(mocks.send).toHaveBeenCalledWith({ email: 'writer@example.test', type: 'email-verification' });
    expect(container.textContent).toContain('writer@example.test');
    expect(container.querySelector('[data-input-otp]')).not.toBeNull();
  });

  it('keeps the address form when sending the code fails, with a clear error', async () => {
    mocks.send.mockResolvedValue({ error: { code: 'AUTH_EMAIL_UNAVAILABLE' } });
    await render();
    await enter('#verification-email', 'writer@example.test');
    await act(async () => button('Send a new code')?.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('The code could not be sent. Please try sending a new one.');
    expect(container.querySelector('#verification-email')).not.toBeNull();
  });

  it('says when a code is wrong and lets the writer try again', async () => {
    mocks.search = { email: 'writer@example.test' };
    mocks.verify.mockResolvedValue({ error: { code: 'INVALID_OTP' } });
    await render();
    await enter('[data-input-otp]', '000000');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('[data-input-otp]')).not.toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('still verifies a valid legacy link and returns to the page that asked for sign-in', async () => {
    mocks.checkLink.mockResolvedValue({ error: null });
    mocks.search = { token: 'valid', next: '/app/projects/p1/settings?section=members' };
    await render();
    expect(mocks.checkLink).toHaveBeenCalledWith({ query: { token: 'valid' } });
    expect(mocks.push).toHaveBeenCalledWith('/app/projects/p1/settings?section=members');
    expect(container.querySelector('#verification-email')).toBeNull();
  });
});
