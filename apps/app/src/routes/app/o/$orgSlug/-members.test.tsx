// @vitest-environment jsdom
import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type OrgRole = 'owner' | 'admin' | 'member';

const mocks = vi.hoisted(() => ({
  orgRole: 'owner' as OrgRole,
  members: {} as Record<string, unknown>,
  membersFor: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => (vars ? `${key}(${Object.values(vars).join('|')})` : key),
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children, to, params }: { children: ReactNode; to: string; params?: { orgSlug: string } }) => (
    <a href={to.replace('$orgSlug', params?.orgSlug ?? '')}>{children}</a>
  ),
}));
vi.mock('@/components/organization/organization-context', () => ({
  useCurrentOrganization: () => ({ id: 'org-1', slug: 'acme', name: 'Acme Docs', logo: null, orgRole: mocks.orgRole, canCreateWebsite: true }),
  isOrgAdmin: (organization: { orgRole: OrgRole }) => organization.orgRole !== 'member',
}));
vi.mock('@/components/app/org-switcher/switcher-panel', () => ({
  ORG_ROLE_LABEL: { owner: 'roles.owner', admin: 'roles.admin', member: 'roles.organizationMember' },
}));
vi.mock('@/hooks/api', () => ({
  useOrganizationMembers: (id?: string) => {
    mocks.membersFor(id);
    return mocks.members;
  },
}));
vi.mock('@/hooks/api/organization-query-options', () => ({ organizationMembersQueryOptions: (id: string) => ({ queryKey: ['members', id] }) }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@nibleaf/i18n/locale-state', () => ({ getLocale: () => 'en', subscribeLanguage: () => () => undefined }));

import { Route } from './members';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const MembersPage = Route.options.component as unknown as ComponentType;
let root: ReturnType<typeof createRoot>;

const member = (id: string, name: string, orgRole: OrgRole, grants: string[] = []) => ({
  id,
  userId: `user-${id}`,
  orgRole,
  createdAt: '2026-01-15T00:00:00.000Z',
  user: { id: `user-${id}`, name, email: `${id}@example.com`, image: null },
  projectGrants: grants.map((projectName, index) => ({
    projectId: `p-${index}`,
    role: 'member',
    project: { id: `p-${index}`, name: projectName },
  })),
});

beforeEach(() => {
  mocks.orgRole = 'owner';
  mocks.members = {
    isPending: false,
    data: [
      member('sara', 'Sara', 'owner'),
      member('omar', 'Omar', 'admin'),
      member('lina', 'Lina', 'member', ['Developer docs', 'API reference']),
      member('rami', 'Rami', 'member', ['Handbook']),
      member('noor', 'Noor', 'member'),
    ],
  };
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function render() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<MembersPage />));
  return host;
}
const row = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`[data-member="${id}"]`) as HTMLElement;
const cells = (host: HTMLElement, id: string) => [...row(host, id).querySelectorAll('td')].map((cell) => cell.textContent);

describe('organization Members page', () => {
  it('a Member gets AdminRequired and the members are never requested', async () => {
    mocks.orgRole = 'member';
    const host = await render();
    expect(host.textContent).toContain('organization.adminRequired.title');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/app/o/acme/websites');
    expect(host.querySelector('table')).toBeNull();
    expect(mocks.membersFor).toHaveBeenCalledWith(undefined);
  });

  it.each(['owner', 'admin'] as const)('%s sees every member with org role and website access', async (role) => {
    mocks.orgRole = role;
    const host = await render();
    expect(mocks.membersFor).toHaveBeenCalledWith('org-1');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(cells(host, 'sara')[1]).toBe('roles.owner');
    expect(cells(host, 'sara')[2]).toBe('organization.members.allWebsites');
    expect(cells(host, 'omar')[1]).toBe('roles.admin');
    expect(cells(host, 'omar')[2]).toBe('organization.members.allWebsites');
    expect(cells(host, 'lina')[1]).toBe('roles.organizationMember');
    // Pluralized through count(): {count, form}.
    expect(cells(host, 'lina')[2]).toBe('organization.members.websites(2|other)');
    expect(row(host, 'lina').querySelectorAll('td')[2]?.getAttribute('title')).toBe('Developer docs, API reference');
    expect(cells(host, 'rami')[2]).toBe('organization.members.websites(1|one)');
    expect(cells(host, 'noor')[2]).toBe('organization.members.noWebsites');
    expect(row(host, 'noor').querySelectorAll('td')[2]?.hasAttribute('title')).toBe(false);
    expect(cells(host, 'lina')[0]).toContain('lina@example.com');
  });

  it('the Invite button is a disabled placeholder that explains itself', async () => {
    const host = await render();
    const invite = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('organization.members.invite'));
    expect(invite?.disabled).toBe(true);
    expect(invite?.getAttribute('title')).toBe('organization.members.inviteSoon');
    const notice = document.getElementById(invite?.getAttribute('aria-describedby') ?? '');
    expect(notice?.textContent).toBe('organization.members.readOnlyNotice');
  });

  it('shows skeleton rows while members load', async () => {
    mocks.members = { isPending: true };
    const host = await render();
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(host.querySelector('[data-member]')).toBeNull();
  });
});
