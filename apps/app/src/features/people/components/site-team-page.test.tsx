// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  team: vi.fn(),
  invite: vi.fn(),
  mutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${Object.values(vars).join('|')})` : key),
}));
vi.mock('@nibleaf/i18n/locale-state', () => ({ getLocale: () => 'en', subscribeLanguage: () => () => undefined }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'u-me' } } }) }));
vi.mock('@/hooks/api/queries', () => ({ useProjectMembers: () => mocks.team() }));
vi.mock('../api/query-options', () => ({
  siteJoinLinksQueryOptions: (id: string) => ({ queryKey: ['members', id, 'join-links'], queryFn: async () => [] }),
}));
vi.mock('../api/mutations', () => {
  const mutation = mocks.mutation;
  return {
    useChangeSiteRole: mutation,
    useRemoveFromSite: mutation,
    useRevokeSiteInvitation: mutation,
    useResendSiteInvitation: mutation,
    useInviteToSite: () => ({ mutateAsync: mocks.invite, isPending: false }),
    useCreateJoinLink: mutation,
    useRegenerateJoinLink: mutation,
    useDisableJoinLink: mutation,
    useDeleteJoinLink: mutation,
    isAlreadyAccepted: () => false,
  };
});
vi.mock('@/hooks/api/people', () => ({ useInviteSuggestions: () => ({ data: [], isSuccess: false }) }));
vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: ReactNode }) => <a href="/members">{children}</a> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SiteTeamPage } from './site-team-page';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root;
let host: HTMLDivElement;
const person = (id: string, role: string, viaOrganization = false) => ({
  id: `m-${id}`,
  userId: `u-${id}`,
  orgRole: viaOrganization ? role : 'member',
  createdAt: '2026-01-01T00:00:00.000Z',
  role,
  viaOrganization,
  user: { id: `u-${id}`, name: id === 'nameless' ? '' : id, email: `${id}@example.test`, image: null },
});
const organization = { id: 'org-1', slug: 'acme', name: 'Acme', logo: null, orgRole: 'admin' as const, canCreateWebsite: true, websiteCount: 2 };
async function render() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <SiteTeamPage organization={organization} projectId="site-1" siteName="Docs" />
      </QueryClientProvider>,
    ),
  );
  return host;
}
const team = (members: ReturnType<typeof person>[], invitations: unknown[] = []) => ({
  data: { members, invitations },
  isPending: false,
  isError: false,
});

beforeEach(() => {
  mocks.team.mockReturnValue(
    team([person('owner', 'owner', true), person('me', 'admin', true), person('lina', 'member'), person('nameless', 'viewer')]),
  );
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('website Team page', () => {
  it('splits people "from the organization" and "website access", with no stray "?" (WORKSPACE-10)', async () => {
    await render();
    const text = host.textContent ?? '';
    expect(text).toContain('people.site.fromOrg');
    expect(text).toContain('settings.members.viaOrganization');
    expect(text).not.toContain('?');
    expect(text).toContain('nameless@example.test');
    expect(host.querySelector('h1')?.textContent).toBe('people.site.title');
  });

  it('shows no pending-invitations section when there are none (defect 3)', async () => {
    await render();
    expect(host.textContent).not.toContain('people.invitations.title');
  });

  it('lists pending invitations with inviter and expiry when there are some', async () => {
    mocks.team.mockReturnValue(
      team(
        [person('me', 'admin', true)],
        [
          {
            id: 'i-1',
            email: 'new@example.test',
            role: 'member',
            createdAt: '2026-11-08T00:00:00Z',
            expiresAt: '2099-01-01T00:00:00Z',
            inviter: { name: 'Sara', email: 's@x' },
          },
        ],
      ),
    );
    await render();
    expect(host.textContent).toContain('people.invitations.title');
    expect(host.textContent).toContain('new@example.test');
    expect(host.textContent).toContain('people.invitations.invitedBy(Sara');
  });

  it('an Editor sees the team read-only with one line saying why', async () => {
    mocks.team.mockReturnValue(team([person('owner', 'owner', true), person('me', 'member'), person('lina', 'viewer')]));
    await render();
    expect(host.textContent).toContain('people.site.readOnly(roles.editor)');
    expect([...host.querySelectorAll('button')].some((button) => button.textContent?.includes('people.site.add'))).toBe(false);
    expect(host.textContent).not.toContain('people.links.title');
  });

  it('Add people opens a dialog whose email error appears only after submit, never on an untouched form (defect 1)', async () => {
    await render();
    const add = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('people.site.add'));
    await act(async () => add?.click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).not.toContain('people.invite.error.emailRequired');
    const submit = [...(dialog?.querySelectorAll('button[type="submit"]') ?? [])][0] as HTMLButtonElement | undefined;
    expect(submit?.disabled).toBe(false);
    await act(async () => submit?.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('people.invite.error.emailRequired');
    expect(mocks.invite).not.toHaveBeenCalled();
  });
});
