// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), updateUser: vi.fn(), send: vi.fn(), requestChange: vi.fn(), toastError: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/services/auth-client', () => ({
  useSession: mocks.session,
  authClient: { updateUser: mocks.updateUser, emailOtp: { sendVerificationOtp: mocks.send, requestEmailChange: mocks.requestChange } },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.toastError } }));

import { AccountTab } from './account-tab';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
document.elementFromPoint = () => null;
const user = { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.test', emailVerified: true };

describe('account settings hydration', () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    mocks.session.mockReturnValue({ data: { user }, isPending: false });
    container = document.createElement('div');
    document.body.append(container);
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('hydrates without replacing the server tree when the browser session has already resolved', async () => {
    mocks.session.mockReturnValue({ data: null, isPending: true });
    container.innerHTML = renderToString(<AccountTab />);
    mocks.session.mockReturnValue({ data: { user }, isPending: false });
    const recoverableErrors = vi.fn();
    await act(async () => {
      root = hydrateRoot(container, <AccountTab />, { onRecoverableError: recoverableErrors });
    });
    expect(recoverableErrors).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>('#acct-name')?.value).toBe('Ada Lovelace');
    expect(container.textContent).toContain('ada@example.test');
  });

  it('does not render sensitive cached account values on the server', () => {
    const html = renderToString(<AccountTab />);
    expect(html).not.toContain('ada@example.test');
    expect(html).not.toContain('Ada Lovelace');
    expect(html).not.toContain('acct-name');
    expect(html).toContain('common.loading');
  });

  it('keeps account actions unavailable while the session is still loading', async () => {
    mocks.session.mockReturnValue({ data: null, isPending: true });
    root = createRoot(container);
    await act(async () => root?.render(<AccountTab />));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('common.loading');
    expect(container.querySelector('#acct-name')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('preserves a typed name draft when the same account session refreshes', async () => {
    root = createRoot(container);
    await act(async () => root?.render(<AccountTab />));
    const input = container.querySelector<HTMLInputElement>('#acct-name');
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Unsaved profile draft');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    mocks.session.mockReturnValue({ data: { user: { ...user, name: 'Refreshed server name' } }, isPending: false });
    await act(async () => root?.render(<AccountTab />));
    expect(container.querySelector<HTMLInputElement>('#acct-name')?.value).toBe('Unsaved profile draft');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  async function beginEmailChange() {
    root = createRoot(container);
    await act(async () => root?.render(<AccountTab />));
    const change = [...container.querySelectorAll('button')].find((button) => button.textContent === 'settings.account.email.change');
    await act(async () => change?.click());
    const input = container.querySelector<HTMLInputElement>('#acct-email');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'new@example.test');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => input?.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  }

  it('localizes required delivery failure while preserving the email-change draft', async () => {
    mocks.send.mockResolvedValue({ error: { code: 'AUTH_EMAIL_UNAVAILABLE', message: 'Unable to send a code. Please try again shortly.' } });
    await beginEmailChange();
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.toastError).toHaveBeenCalledWith('settings.account.email.sendError');
    expect(container.querySelector<HTMLInputElement>('#acct-email')?.value).toBe('new@example.test');
    expect(container.querySelector('#acct-current-email-otp')).toBeNull();
  });

  it('localizes delivery failure for the new address without advancing past current-address verification', async () => {
    mocks.send.mockResolvedValue({ error: null });
    mocks.requestChange.mockResolvedValue({ error: { code: 'AUTH_EMAIL_UNAVAILABLE', message: 'Unable to send a code. Please try again shortly.' } });
    await beginEmailChange();
    const input = container.querySelector<HTMLInputElement>('#acct-current-email-otp');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '123456');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(mocks.requestChange).toHaveBeenCalledExactlyOnceWith({ newEmail: 'new@example.test', otp: '123456' });
    expect(mocks.toastError).toHaveBeenCalledWith('settings.account.email.sendError');
    expect(container.querySelector('#acct-current-email-otp')).not.toBeNull();
    expect(container.querySelector('#acct-email-otp')).toBeNull();
  });
});
