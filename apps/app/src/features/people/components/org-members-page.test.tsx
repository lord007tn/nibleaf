// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';

const mocks = vi.hoisted(() => ({
  members: vi.fn(),
  invitations: vi.fn(),
  links: vi.fn(),
  websites: vi.fn(),
  mutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${Object.values(vars).join('|')})` : key),
}));
vi.mock('@nibleaf/i18n/locale-state', () => ({ getLocale: () => 'en', subscribeLanguage: () => () => undefined }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'u-omar' } } }) }));
vi.mock('@/hooks/api/organization-query-options', () => ({
  organizationMembersQueryOptions: (id: string) => ({ queryKey: ['organizations', id, 'members'], queryFn: mocks.members }),
  organizationProjectsQueryOptions: (id: string) => ({ queryKey: ['organizations', id, 'projects', 'list'], queryFn: mocks.websites }),
}));
vi.mock('../api/query-options', () => ({
  orgInvitationsQueryOptions: (id: string) => ({ queryKey: ['organizations', id, 'invitations'], queryFn: mocks.invitations }),
  orgJoinLinksQueryOptions: (id: string) => ({ queryKey: ['organizations', id, 'join-links'], queryFn: mocks.links }),
}));
vi.mock('../api/mutations', () => {
  const mutation = mocks.mutation;
  return {
    useRemoveOrgMember: mutation,
    useRevokeOrgInvitation: mutation,
    useResendOrgInvitation: mutation,
    useInviteToOrganization: mutation,
    useChangeOrgRole: mutation,
    useReplaceMemberAccess: mutation,
    useCreateJoinLink: mutation,
    useRegenerateJoinLink: mutation,
    useDisableJoinLink: mutation,
    useDeleteJoinLink: mutation,
    isAlreadyAccepted: () => false,
  };
});
vi.mock('@/hooks/api/organizations', () => ({ useTransferOrganizationOwnership: () => mocks.mutation() }));
vi.mock('@/components/organization/admin-required', () => ({ AdminRequired: () => <p>admin-required</p> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { OrgMembersPage } from './org-members-page';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root;
let host: HTMLDivElement;
const organization = { id: 'org-1', slug: 'acme', name: 'Acme', logo: null, orgRole: 'admin' as const, canCreateWebsite: true };
const member = (id: string, name: string, orgRole: string, grants: string[] = [], lastActiveAt: string | null = null) => ({
  id,
  userId: `u-${id}`,
  orgRole,
  createdAt: '2026-01-15T00:00:00.000Z',
  lastActiveAt,
  user: { id: `u-${id}`, name, email: `${id}@example.test`, image: null },
  projectGrants: grants.map((projectName, index) => ({ projectId: `p-${index}`, role: 'member', project: { id: `p-${index}`, name: projectName } })),
});
const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
};
async function render(node: ReactNode = <OrgMembersPage organization={organization} />) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
  await flush();
  return host;
}
const rows = () => [...host.querySelectorAll('tbody tr')];
const row = (id: string) => host.querySelector<HTMLElement>(`[data-member="${id}"]`);

beforeEach(() => {
  mocks.members.mockResolvedValue([
    member('zed', 'Zed', 'member'),
    member('sara', 'Sara', 'owner', [], '2026-11-10T08:00:00.000Z'),
    member('omar', 'Omar', 'admin'),
    member('lina', 'Lina', 'member', ['Docs', 'API', 'Blog']),
    member('anon', '', 'member', ['Docs']),
  ]);
  mocks.invitations.mockResolvedValue([]);
  mocks.links.mockResolvedValue([]);
  mocks.websites.mockResolvedValue([{ id: 'p-0', name: 'Docs' }]);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('organization Members page', () => {
  it('lists Owner, Admins then Members, marks you, and shows website chips with +N', async () => {
    await render();
    expect(rows().map((tr) => tr.getAttribute('data-member'))).toEqual(['sara', 'omar', 'anon', 'lina', 'zed']);
    expect(row('omar')?.textContent).toContain('people.you');
    expect(row('sara')?.textContent).toContain('people.access.all');
    expect(row('zed')?.textContent).toContain('people.access.none');
    expect(row('lina')?.textContent).toContain('+1');
    expect(row('lina')?.textContent).toContain('API');
  });

  it('shows a nameless person by email with initials from it, not a "U" placeholder', async () => {
    await render();
    const anon = row('anon');
    expect(anon?.textContent).toContain('anon@example.test');
    expect(anon?.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe('AN');
  });

  it('filters by search and offers to clear filters when nothing matches', async () => {
    await render();
    const search = host.querySelector<HTMLInputElement>('input[type="search"]');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setValue?.call(search, 'lin');
      search?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(rows().map((tr) => tr.getAttribute('data-member'))).toEqual(['lina']);
    await act(async () => {
      setValue?.call(search, 'nobody');
      search?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.textContent).toContain('people.filter.noMatch');
    expect(host.textContent).toContain('people.filter.clear');
  });

  it('labels each row menu with the person, and the Owner cannot be edited (no name button)', async () => {
    await render();
    expect(row('lina')?.querySelector('button[aria-label="people.members.actionsFor(Lina)"]')).not.toBeNull();
    expect(row('lina')?.querySelector('td button')?.textContent).toContain('people.members.manage');
    // The Owner's role changes only by transfer, and you can't edit yourself: no edit button on the name.
    expect([...(row('sara')?.querySelectorAll('td:first-child button') ?? [])]).toHaveLength(0);
    expect([...(row('omar')?.querySelectorAll('td:first-child button') ?? [])]).toHaveLength(0);
  });

  it('shows counts, and empty sections that offer the action', async () => {
    await render();
    const text = host.textContent ?? '';
    expect(text).toContain('people.invitations.empty');
    expect(text).toContain('people.links.empty');
    expect([...host.querySelectorAll('button')].filter((b) => b.textContent?.includes('people.links.create')).length).toBeGreaterThanOrEqual(2);
  });

  it('shows skeleton rows while members load', async () => {
    mocks.members.mockReturnValue(new Promise(() => undefined));
    await render();
    expect(host.querySelector('[data-slot="data-list-skeleton"]')).not.toBeNull();
    expect(host.querySelector('table')).toBeNull();
  });

  it('turns a 403 (demoted while looking) into the Administrator-required state', async () => {
    mocks.members.mockRejectedValue(new ApiResponseError('forbidden', 403));
    await render();
    expect(host.textContent).toContain('admin-required');
  });
});
