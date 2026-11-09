// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  updateUser: vi.fn(),
  send: vi.fn(),
  requestChange: vi.fn(),
  changeEmail: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/services/auth-client', () => ({
  useSession: mocks.session,
  authClient: {
    updateUser: mocks.updateUser,
    emailOtp: { sendVerificationOtp: mocks.send, requestEmailChange: mocks.requestChange, changeEmail: mocks.changeEmail },
  },
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

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

  async function typeCode(id: string, code: string) {
    const input = container.querySelector<HTMLInputElement>(id);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, code);
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function beginEmailChange(address = 'new@example.test') {
    root = createRoot(container);
    await act(async () => root?.render(<AccountTab />));
    await requestCode(address);
  }

  /** Open "Change email" on the mounted tab and submit an address. */
  async function requestCode(address: string) {
    const change = [...container.querySelectorAll('button')].find((button) => button.textContent === 'settings.account.email.change');
    await act(async () => change?.click());
    const input = container.querySelector<HTMLInputElement>('#acct-email');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, address);
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => input?.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  }

  const deferred = <T,>() => {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const button = (label: string) => [...container.querySelectorAll('button')].find((element) => element.textContent === label);

  it('ignores a code request that answers after Cancel, clears the draft and returns focus', async () => {
    const send = deferred<{ error: null }>();
    mocks.send.mockReturnValue(send.promise);
    await beginEmailChange();
    expect(mocks.send).toHaveBeenCalledOnce();
    await act(async () => button('common.cancel')?.click());
    expect(document.activeElement).toBe(button('settings.account.email.change'));

    await act(async () => send.resolve({ error: null }));
    expect(container.querySelector('#acct-current-email-otp')).toBeNull();
    expect(container.querySelector('#acct-email')).toBeNull();
    expect(button('settings.account.email.change')).toBeDefined();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();

    // Starting again begins from an empty address.
    await act(async () => button('settings.account.email.change')?.click());
    expect(container.querySelector<HTMLInputElement>('#acct-email')?.value).toBe('');
  });

  it('requests one code when the form is submitted twice in the same moment', async () => {
    const send = deferred<{ error: null }>();
    mocks.send.mockReturnValue(send.promise);
    root = createRoot(container);
    await act(async () => root?.render(<AccountTab />));
    const change = [...container.querySelectorAll('button')].find((b) => b.textContent === 'settings.account.email.change');
    await act(async () => change?.click());
    const input = container.querySelector<HTMLInputElement>('#acct-email');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'new@example.test');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Both submits land before React re-renders with the busy state.
    await act(async () => {
      const form = input?.closest('form');
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(mocks.send).toHaveBeenCalledOnce();
    await act(async () => send.resolve({ error: null }));
  });

  it('keeps a restarted send busy when a cancelled one answers late, so no extra code is requested', async () => {
    const first = deferred<{ error: null }>();
    const second = deferred<{ error: null }>();
    mocks.send.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await beginEmailChange();
    await act(async () => button('common.cancel')?.click());
    await requestCode('other@example.test');
    expect(mocks.send).toHaveBeenCalledTimes(2);

    // The abandoned request finishes while the new one is still on its way.
    await act(async () => first.resolve({ error: null }));
    const send = [...container.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((b) =>
      b.closest('form')?.querySelector('#acct-email'),
    );
    expect(send?.getAttribute('aria-busy') === 'true' || send?.disabled).toBe(true);
    const input = container.querySelector<HTMLInputElement>('#acct-email');
    await act(async () => input?.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(mocks.send).toHaveBeenCalledTimes(2);

    await act(async () => second.resolve({ error: null }));
    expect(container.querySelector('#acct-current-email-otp')).not.toBeNull();
  });

  it('ignores a current-address verification that answers after Cancel', async () => {
    const request = deferred<{ error: null }>();
    mocks.send.mockResolvedValue({ error: null });
    mocks.requestChange.mockReturnValue(request.promise);
    await beginEmailChange();
    await typeCode('#acct-current-email-otp', '123456');
    expect(mocks.requestChange).toHaveBeenCalledOnce();
    mocks.toastSuccess.mockClear();
    await act(async () => button('common.cancel')?.click());
    expect(document.activeElement).toBe(button('settings.account.email.change'));

    await act(async () => request.resolve({ error: null }));
    expect(container.querySelector('#acct-email-otp')).toBeNull();
    expect(container.querySelector('#acct-current-email-otp')).toBeNull();
    expect(button('settings.account.email.change')).toBeDefined();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('cannot be cancelled once the final confirmation is on its way (the address may already have changed)', async () => {
    const change = deferred<{ error: { status: number; message: string } }>();
    mocks.send.mockResolvedValue({ error: null });
    mocks.requestChange.mockResolvedValue({ error: null });
    mocks.changeEmail.mockReturnValue(change.promise);
    await beginEmailChange();
    await typeCode('#acct-current-email-otp', '123456');
    await typeCode('#acct-email-otp', '654321');
    expect(mocks.changeEmail).toHaveBeenCalledOnce();
    expect(button('common.cancel')?.disabled).toBe(true);

    await act(async () => change.resolve({ error: { status: 400, message: 'Invalid OTP' } }));
    expect(button('common.cancel')?.disabled).toBe(false);
  });

  it('stops at the form when the new address is the current one, instead of sending codes that can never work', async () => {
    await beginEmailChange(' ADA@example.test ');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(container.querySelector('#acct-email-error')?.textContent).toBe('settings.account.email.sameAsCurrent');
    expect(container.querySelector('#acct-current-email-otp')).toBeNull();
  });

  it('says the address is taken at the confirm step, never the English server text', async () => {
    mocks.send.mockResolvedValue({ error: null });
    mocks.requestChange.mockResolvedValue({ error: null });
    mocks.changeEmail.mockResolvedValue({ error: { status: 400, message: 'Email already in use' } });
    await beginEmailChange();
    await typeCode('#acct-current-email-otp', '123456');
    await typeCode('#acct-email-otp', '654321');

    expect(mocks.changeEmail).toHaveBeenCalledExactlyOnceWith({ newEmail: 'new@example.test', otp: '654321' });
    expect(mocks.toastError).toHaveBeenLastCalledWith('settings.account.email.inUse');
  });

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
