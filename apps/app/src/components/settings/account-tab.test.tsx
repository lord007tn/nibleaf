// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), updateUser: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/services/auth-client', () => ({ useSession: mocks.session, authClient: { updateUser: mocks.updateUser, emailOtp: {} } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AccountTab } from './account-tab';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
});
