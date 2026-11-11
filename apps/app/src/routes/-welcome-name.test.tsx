// @vitest-environment jsdom
import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), update: vi.fn(), navigate: vi.fn(), signOut: vi.fn(), prefetch: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (id: string) => (options: Record<string, unknown>) => ({
    id,
    options,
    useRouteContext: () => ({ nameDestination: '/app/projects/p1?lang=ar#members' }),
  }),
  redirect: (options: unknown) => ({ redirect: options }),
  useRouter: () => ({ navigate: mocks.navigate }),
}));
vi.mock('@/components/auth-providers', () => ({ AuthProviders: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/layouts/auth', () => ({
  AuthLayout: ({ children, subtitle }: { children: ReactNode; subtitle: string }) => (
    <main>
      <h1>{subtitle}</h1>
      {children}
    </main>
  ),
}));
vi.mock('@/functions/session', () => ({ getSessionFn: mocks.session }));
vi.mock('@/services/auth-client', () => ({ authClient: { updateUser: mocks.update, signOut: mocks.signOut } }));
vi.mock('@/features/people/components/admission', () => ({ AcceptInvitationView: () => null, JoinLinkView: () => null }));
vi.mock('@/hooks/api/query-options', () => ({
  getInvitationInfoQueryOptions: vi.fn(),
  joinLinkPreviewQueryOptions: vi.fn(),
  getPublicMetaQueryOptions: vi.fn(),
}));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: mocks.prefetch }));

import { Route as InviteRoute } from './accept-invite.$invitationId';
import { Route as JoinRoute } from './join.$token';
import { Route } from './welcome.name';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const Page = Route.options.component as unknown as ComponentType;
const beforeLoad = Route.options.beforeLoad as (ctx: { search: { redirect?: string } }) => Promise<unknown>;
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'new-user', name: '' } });
  mocks.update.mockResolvedValue({});
  mocks.signOut.mockResolvedValue({});
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('dashboard name step', () => {
  it('opens for an empty name and keeps the original destination', async () => {
    await expect(beforeLoad({ search: { redirect: '/app/projects/p1?lang=ar#members' } })).resolves.toEqual({
      nameDestination: '/app/projects/p1?lang=ar#members',
    });
    await act(async () => root.render(<Page />));
    expect(host.querySelector('h1')?.textContent).toBe('auth.name.title');
  });
  it('returns a named user immediately to the validated destination', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'existing', name: 'Ada' } });
    await expect(beforeLoad({ search: { redirect: '/app/projects/p1' } })).rejects.toEqual({ redirect: { href: '/app/projects/p1' } });
  });
  it('rejects an off-origin destination before sending a signed-out visitor to sign in', async () => {
    mocks.session.mockResolvedValue(null);
    await expect(beforeLoad({ search: { redirect: 'https://evil.example/app' } })).rejects.toEqual({
      redirect: { to: '/sign-in', search: { next: '/app' } },
    });
  });
  it('keeps invite and join routes outside the dashboard gate', () => {
    for (const route of [InviteRoute, JoinRoute]) {
      expect((route as unknown as { id: string }).id).not.toMatch(/^\/app/);
      expect((route.options as { beforeLoad?: unknown }).beforeLoad).toBeUndefined();
    }
  });
  const enterName = async (value: string) =>
    act(async () => {
      const input = host.querySelector<HTMLInputElement>('#welcome-name');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const submit = () =>
    act(async () => {
      host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  it('saves through update-user and returns to the original path', async () => {
    await act(async () => root.render(<Page />));
    await enterName('  Ada Lovelace  ');
    await submit();
    expect(mocks.update).toHaveBeenCalledWith({ name: 'Ada Lovelace' });
    expect(mocks.navigate).toHaveBeenCalledWith({ href: '/app/projects/p1?lang=ar#members', replace: true });
  });
  it('requires a nonblank name and stays on the step when saving fails', async () => {
    await act(async () => root.render(<Page />));
    await enterName('   ');
    await submit();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('auth.name.required');
    await enterName('Ada');
    mocks.update.mockResolvedValue({ error: { message: 'Synthetic failure' } });
    await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('auth.error.tryAgain');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it('allows sign-out without entering a name', async () => {
    await act(async () => root.render(<Page />));
    const button = [...host.querySelectorAll('button')].find((node) => node.textContent === 'account.signOut');
    await act(async () => button?.click());
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/sign-in', replace: true });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
