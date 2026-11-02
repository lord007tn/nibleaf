// @vitest-environment jsdom

import { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => (key === 'admin.signIn.sendError' ? 'تعذر إرسال رمز تسجيل الدخول.' : key) }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/services/auth-client', () => ({ authClient: { emailOtp: { sendVerificationOtp: mocks.send } } }));

import { Route } from './sign-in';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('announces the localized delivery error without advancing to code entry', async () => {
  mocks.send.mockResolvedValue({ error: { code: 'AUTH_EMAIL_UNAVAILABLE', message: 'Unable to send a code. Please try again shortly.' } });
  const Page = Route.options.component as unknown as ComponentType;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Page />));
    const input = container.querySelector<HTMLInputElement>('#email');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'admin@example.test');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(false);
    await act(async () => submit?.click());
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('تعذر إرسال رمز تسجيل الدخول.');
    expect(container.textContent).not.toContain('Unable to send a code.');
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(container.querySelector('[data-input-otp]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
