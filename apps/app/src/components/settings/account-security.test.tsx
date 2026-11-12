// @vitest-environment jsdom
import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Callbacks = { onSuccess?: (value?: unknown) => unknown; onError?: (error: unknown) => unknown };
type Org = { id: string; slug: string; name: string; orgRole: 'owner' | 'admin' | 'member' };

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  confirm: vi.fn(),
  deleteAccount: vi.fn(),
  signOut: vi.fn(),
  updatePreferences: vi.fn(),
  revoke: vi.fn(),
  revokeOthers: vi.fn(),
  toastError: vi.fn(),
  organizations: [] as Org[],
  notifications: {} as Record<string, boolean>,
  sessions: [] as Array<{ id: string; token: string; userAgent: string | null; ipAddress: string | null; updatedAt: string }>,
}));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => (vars ? `${key}(${Object.values(vars).join('|')})` : key),
}));
vi.mock('@nibleaf/i18n/locale-state', () => ({ getLocale: () => 'en', renderedLocale: () => 'en', subscribeLanguage: () => () => undefined }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  Link: ({ children, to, params, onClick }: { children: ReactNode; to: string; params?: { orgSlug: string }; onClick?: () => void }) => (
    <a href={to.replace('$orgSlug', params?.orgSlug ?? '')} onClick={onClick}>
      {children}
    </a>
  ),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ marker: 'query-client' }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.toastError } }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/hooks/api', () => ({
  PERSONAL_NOTIFICATION_KEYS: ['security_login', 'project_deploy', 'member_joined'],
  useSwitcher: () => ({ data: { organizations: mocks.organizations, recent: [], landing: null }, isPending: false }),
  useMyPreferences: () => ({ data: { notifications: mocks.notifications }, isPending: false, isError: false }),
  useUpdatePreferences: () => ({ mutate: mocks.updatePreferences }),
}));
vi.mock('@/hooks/api/account', () => ({
  useDeleteAccount: () => ({ mutate: mocks.deleteAccount, isPending: false }),
  useAccountSessions: () => ({ data: mocks.sessions, isPending: false, isError: false }),
  useRevokeSession: () => ({ mutate: mocks.revoke, isPending: false }),
  useRevokeOtherSessions: () => ({ mutate: mocks.revokeOthers, isPending: false }),
  useLinkedAccounts: () => ({ data: [], isPending: false }),
}));
vi.mock('@/services/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'u-1', email: 'raed@example.com' }, session: { token: 'tok-current' } } }),
}));
vi.mock('@/services/dashboard-session', () => ({ signOutDashboard: mocks.signOut }));

import { DeleteAccountSection, PersonalNotificationsSection, SessionsSection } from './account-security';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  mocks.organizations = [];
  mocks.notifications = {};
  mocks.sessions = [];
  mocks.confirm.mockResolvedValue(true);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function render(element: ReactElement) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(element));
  return host;
}
const button = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === text) as HTMLButtonElement;
const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

describe('DeleteAccountSection', () => {
  it('an org Owner is blocked: the dialog lists owned orgs with links to their settings, and nothing is deleted', async () => {
    mocks.organizations = [
      { id: 'o-1', slug: 'acme', name: 'Acme Docs', orgRole: 'owner' },
      { id: 'o-2', slug: 'jood', name: 'JOODPMS', orgRole: 'admin' },
      { id: 'o-3', slug: 'solo', name: 'Solo org', orgRole: 'owner' },
    ];
    const host = await render(<DeleteAccountSection />);
    await act(async () => button(host, 'account.delete.button').click());
    await flush();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('account.delete.blockedTitle');
    const rows = [...dialog.querySelectorAll('[data-slot="owned-organizations"] li')];
    expect(rows.map((row) => row.querySelector('bdi')?.textContent)).toEqual(['Acme Docs', 'Solo org']);
    expect(rows.map((row) => row.querySelector('a')?.getAttribute('href'))).toEqual(['/app/o/acme/settings', '/app/o/solo/settings']);
    await act(async () => rows[0]?.querySelector('a')?.click());
    await flush();
    expect(document.querySelector('[data-slot="owned-organizations"]')).toBeNull();
  });

  it('without owned orgs it confirms, then deletes and signs out', async () => {
    mocks.organizations = [{ id: 'o-2', slug: 'jood', name: 'JOODPMS', orgRole: 'admin' }];
    mocks.deleteAccount.mockImplementation((_input: unknown, callbacks: Callbacks) => callbacks.onSuccess?.());
    const host = await render(<DeleteAccountSection />);
    await act(async () => button(host, 'account.delete.button').click());
    await flush();
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'account.delete.title', destructive: true }));
    expect(document.querySelector('[data-slot="owned-organizations"]')).toBeNull();
    expect(mocks.deleteAccount).toHaveBeenCalledOnce();
    expect(mocks.signOut).toHaveBeenCalledWith({ marker: 'query-client' }, expect.any(Function));
    const [, leave] = mocks.signOut.mock.calls[0] as [unknown, () => Promise<unknown>];
    await leave();
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/sign-in', replace: true });
  });

  it('cancelling the confirmation keeps the account', async () => {
    mocks.confirm.mockResolvedValue(false);
    const host = await render(<DeleteAccountSection />);
    await act(async () => button(host, 'account.delete.button').click());
    await flush();
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
  });
});

describe('PersonalNotificationsSection', () => {
  it('shows each personal email toggle (default on) and saves a flip as { key: bool }', async () => {
    mocks.notifications = { project_deploy: false };
    const host = await render(<PersonalNotificationsSection />);
    const switches = [...host.querySelectorAll<HTMLElement>('[role="switch"]')];
    expect(switches).toHaveLength(3);
    expect(switches.map((node) => node.getAttribute('aria-checked'))).toEqual(['true', 'false', 'true']);
    expect(document.getElementById(switches[0]?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
      'settings.notifications.securityLogin.label',
    );
    await act(async () => switches[0]?.click());
    expect(mocks.updatePreferences).toHaveBeenCalledWith({ security_login: false }, expect.anything());
    await act(async () => switches[1]?.click());
    expect(mocks.updatePreferences).toHaveBeenLastCalledWith({ project_deploy: true }, expect.anything());
  });

  it('a failed save shows an error toast', async () => {
    mocks.updatePreferences.mockImplementation((_input: unknown, callbacks: Callbacks) => callbacks.onError?.(new Error('nope')));
    const host = await render(<PersonalNotificationsSection />);
    await act(async () => host.querySelector<HTMLElement>('[role="switch"]')?.click());
    expect(mocks.toastError).toHaveBeenCalledWith('account.notifications.error');
  });
});

describe('SessionsSection', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const firefox = 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0';

  it('lists this device first with a badge, and signs out another one', async () => {
    mocks.sessions = [
      { id: 's-2', token: 'tok-other', userAgent: firefox, ipAddress: '10.0.0.2', updatedAt: '2026-11-09T00:00:00.000Z' },
      { id: 's-1', token: 'tok-current', userAgent: chrome, ipAddress: '10.0.0.1', updatedAt: '2026-11-10T00:00:00.000Z' },
    ];
    const host = await render(<SessionsSection />);
    const rows = [...host.querySelectorAll('li')];
    expect(rows[0]?.textContent).toContain('Chrome');
    expect(rows[0]?.textContent).toContain('account.sessions.thisDevice');
    expect(button(rows[0] as HTMLElement, 'account.sessions.signOut')).toBeUndefined();
    expect(rows[1]?.textContent).toContain('Firefox');
    expect(rows[1]?.textContent).not.toContain('account.sessions.thisDevice');
    await act(async () => button(rows[1] as HTMLElement, 'account.sessions.signOut').click());
    expect(mocks.revoke).toHaveBeenCalledWith('tok-other', expect.anything());
    await act(async () => button(host, 'account.sessions.signOutOthers').click());
    expect(mocks.revokeOthers).toHaveBeenCalledOnce();
  });

  it('hides "sign out others" with a single session', async () => {
    mocks.sessions = [{ id: 's-1', token: 'tok-current', userAgent: null, ipAddress: null, updatedAt: '2026-11-10T00:00:00.000Z' }];
    const host = await render(<SessionsSection />);
    expect(button(host, 'account.sessions.signOutOthers')).toBeUndefined();
    expect(host.textContent).toContain('account.sessions.unknownDevice');
  });
});
