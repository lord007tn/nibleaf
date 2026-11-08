// @vitest-environment jsdom
import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  people: vi.fn(),
  invite: { mutate: vi.fn(), isPending: false, variables: undefined },
  changeRole: { mutate: vi.fn(), isPending: false, variables: undefined },
  remove: { mutate: vi.fn(), isPending: false, variables: undefined },
  revoke: { mutate: vi.fn(), mutateAsync: vi.fn(() => new Promise(() => undefined)), isPending: false, variables: undefined },
  confirm: vi.fn(async () => true),
}));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, variables?: Record<string, string | number>) => (variables ? `${key}:${Object.values(variables).join('|')}` : key),
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children }: { children: ReactNode }) => <a href="/x">{children}</a>,
}));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@/hooks/api/query-options', () => ({ peopleQueryOptions: () => ({ queryKey: ['people'] }) }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'me' } } }) }));
vi.mock('@/components/members/role-select', () => ({
  RoleSelect: ({ ariaLabel, value }: { ariaLabel: string; value: string }) => <span data-role={value} data-testid="role-select" title={ariaLabel} />,
}));
vi.mock('@/hooks/api', () => ({
  friendlyErrorMessage: (_t: unknown, _e: unknown, key: string) => key,
  usePeople: mocks.people,
  usePeopleChanges: () => ({ invite: mocks.invite, changeRole: mocks.changeRole, remove: mocks.remove, revoke: mocks.revoke }),
}));

import { Route } from './people';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const Page = (Route as unknown as { options: { component: ComponentType } }).options.component;

const overview = {
  sites: [
    { projectId: 'docs', name: 'Docs', myRole: 'owner' },
    { projectId: 'help', name: 'Help center', myRole: 'admin' },
  ],
  people: [
    { user: { id: 'me', name: 'Ada', email: 'ada@acme.com', image: null }, memberships: [{ projectId: 'docs', memberId: 'm-me', role: 'owner' }] },
    {
      user: { id: 'g', name: 'Grace', email: 'grace@acme.com', image: null },
      memberships: [{ projectId: 'docs', memberId: 'm-g', role: 'viewer' }],
    },
  ],
  invitations: [{ id: 'inv-1', email: 'new@acme.com', role: 'member', projectId: 'help', expiresAt: '2030-01-01' }],
};

describe('People page', () => {
  let container: HTMLDivElement;
  let root: Root;
  const render = async () => {
    await act(async () => root.render(<Page />));
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mocks.people.mockReturnValue({ data: overview, isPending: false, isError: false });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('shows each person with their role on each of my sites, and pending invites', async () => {
    await render();
    const cards = [...container.querySelectorAll('[data-testid="person"]')];
    expect(cards).toHaveLength(2);
    // My own row is shown but never editable; the owner role is a label.
    expect(cards[0]?.textContent).toContain('people.you');
    expect(cards[0]?.querySelector('[data-testid="role-select"]')).toBeNull();
    // Grace: a role picker on Docs, and she can be added to Help center.
    expect(cards[1]?.querySelector('[data-testid="role-select"]')?.getAttribute('data-role')).toBe('viewer');
    expect(cards[1]?.textContent).toContain('people.addToSite');
    expect(container.textContent).toContain('new@acme.com');
  });

  it('removes someone from one site through that site, after confirming', async () => {
    await render();
    const remove = container.querySelector<HTMLButtonElement>('[aria-label="people.removeFrom:Grace|Docs"]');
    await act(async () => remove?.click());
    expect(mocks.confirm).toHaveBeenCalled();
    expect(mocks.remove.mutate).toHaveBeenCalledWith({ projectId: 'docs', memberId: 'm-g' }, expect.anything());
  });

  it('invites someone to another site with the chosen role', async () => {
    await render();
    const add = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('people.addToSite'));
    await act(async () => add?.click());
    await act(async () => container.querySelector('form')?.requestSubmit());
    expect(mocks.invite.mutate).toHaveBeenCalledWith({ projectId: 'help', email: 'grace@acme.com', role: 'member' }, expect.anything());
  });

  it('filters people by name or email', async () => {
    await render();
    const input = container.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(input, 'grace@');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelectorAll('[data-testid="person"]')).toHaveLength(1);
  });

  it('explains the page to someone who administers no site', async () => {
    mocks.people.mockReturnValue({ data: { sites: [], people: [], invitations: [] }, isPending: false, isError: false });
    await render();
    expect(container.textContent).toContain('people.empty.title');
  });

  it('sends one revoke per invitation and spins only that row', async () => {
    await render();
    const revoke = container.querySelector<HTMLButtonElement>('[aria-label="settings.members.revokeInvite"]');
    await act(async () => {
      revoke?.click();
      revoke?.click();
    });
    expect(mocks.revoke.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mocks.revoke.mutateAsync).toHaveBeenCalledWith({ projectId: 'help', invitationId: 'inv-1' });
    expect(container.querySelector('[aria-label="settings.members.revokeInvite"]')?.hasAttribute('data-loading')).toBe(true);
  });
});
