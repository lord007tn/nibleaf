// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type AnchorHTMLAttributes, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';

const TOKEN = `nlj_${'a'.repeat(43)}`;
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  invitation: vi.fn(),
  preview: vi.fn(),
  switcher: vi.fn(),
  websites: vi.fn(),
  accept: vi.fn(),
  join: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${Object.values(vars).join('|')})` : key),
}));
vi.mock('@/hooks/api/query-options', () => ({
  getInvitationInfoQueryOptions: (id: string) => ({ queryKey: ['public', 'invitation', id], queryFn: mocks.invitation, retry: false }),
  joinLinkPreviewQueryOptions: (token: string) => ({ queryKey: ['public', 'join', token], queryFn: mocks.preview, retry: false }),
  getPublicMetaQueryOptions: () => ({ queryKey: ['public', 'meta'], queryFn: async () => ({ signupDisabled: false }) }),
  projectsQueryOptions: () => ({ queryKey: ['projects'], queryFn: async () => [] }),
}));
vi.mock('@/hooks/api/organization-query-options', () => ({
  switcherQueryOptions: () => ({ queryKey: ['me', 'switcher'], queryFn: mocks.switcher }),
  organizationProjectsQueryOptions: (id?: string) => ({ queryKey: ['organizations', id, 'projects'], queryFn: mocks.websites }),
}));
vi.mock('@/hooks/api/admissions', () => ({ acceptInvitation: mocks.accept }));
vi.mock('../api/mutations', () => ({ useJoinWithLink: () => ({ mutate: mocks.join, isPending: false }) }));
vi.mock('@/integrations/tanstack-query/session-cache', () => ({ syncDashboardSession: vi.fn() }));
vi.mock('@/stores/active-project', () => ({ rememberActiveProject: vi.fn() }));
vi.mock('@/services/auth-client', () => ({ useSession: mocks.session }));
vi.mock('@/services/dashboard-session', () => ({ signOutDashboard: vi.fn() }));
vi.mock('@/functions/session', () => ({ getSessionFn: async () => mocks.session().data }));
vi.mock('@/components/app/command-palette', () => ({ CommandPaletteProvider: () => null }));
vi.mock('@/components/app/org-switcher/switcher-provider', () => ({ SwitcherProvider: () => null }));
vi.mock('@/components/app/skip-to-content', () => ({ SkipToContent: () => null }));
vi.mock('@/components/app/support-access-banner', () => ({ SupportAccessBanner: () => null }));
vi.mock('@/components/app-providers', () => ({ AppProviders: () => null }));
vi.mock('@/lib/dashboard-intent-preload', () => ({ useDashboardIntentPreload: vi.fn() }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/layouts/auth', () => ({
  AuthLayout: ({ children, subtitle }: { children: ReactNode; subtitle?: string }) => (
    <main>
      <h1>{subtitle}</h1>
      {children}
    </main>
  ),
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Navigate: () => null,
  Outlet: () => null,
  redirect: (options: unknown) => ({ redirect: options }),
  useNavigate: () => mocks.navigate,
  Link: ({ to, children, onClick, search: _search, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; search?: unknown }) => (
    <a
      href={to}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));

import { Route as DashboardRoute } from '@/routes/app/route';
import { AcceptInvitationView, JoinLinkView } from './admission';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root;
let host: HTMLDivElement;
const signedIn = (email = 'lina@example.test') => mocks.session.mockReturnValue({ data: { user: { id: 'u-1', email } }, isPending: false });
const signedOut = () => mocks.session.mockReturnValue({ data: null, isPending: false });
const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
};
async function render(node: ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
  await flush();
  return host;
}
const heading = () => host.querySelector('h1')?.textContent;
// A button with `loading` also carries its (hidden) loading text, so match by inclusion.
const buttons = () =>
  [...host.querySelectorAll('button, a')].map((el) => el.textContent?.trim().replace(/(auth\.invite\.accepting|join\.joining)$/, ''));
const invitation = {
  id: 'inv-1',
  email: 'lina@example.test',
  orgRole: 'member',
  organizationId: 'org-1',
  organizationName: 'Acme',
  organizationLogo: null,
  inviterName: 'Sara',
  grants: [{ projectId: 'p-1', name: 'Docs', role: 'viewer' }],
  status: 'pending',
  expired: false,
};

beforeEach(() => {
  mocks.switcher.mockResolvedValue({ organizations: [], recent: [], landing: null });
  mocks.websites.mockResolvedValue([]);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('accept invitation page', () => {
  it('one honest state for an invalid invitation, with actions for a signed-out visitor (PUBLIC-09)', async () => {
    signedOut();
    mocks.invitation.mockRejectedValue(new ApiResponseError('missing', 404));
    await render(<AcceptInvitationView invitationId="inv-1" />);
    expect(heading()).toBe('people.admission.invalidInvitation');
    expect(host.textContent).not.toContain('auth.invite.subtitle');
    expect(buttons()).toEqual(expect.arrayContaining(['people.admission.logIn', 'people.admission.createAccount']));
    expect(buttons()).not.toContain('auth.backToSignIn');
    expect(document.title).toBe('people.admission.invalidInvitation — Nibleaf');
  });

  it('shows the access once (no duplicated "Member · site (Viewer)" line) and accepts', async () => {
    signedIn();
    mocks.invitation.mockResolvedValue(invitation);
    mocks.accept.mockResolvedValue({ organizationId: 'org-1', landing: { projectId: 'p-1' } });
    await render(<AcceptInvitationView invitationId="inv-1" />);
    expect(heading()).toBe('people.admission.join(Acme)');
    expect(host.textContent?.split('Docs').length).toBe(2);
    expect(host.textContent).toContain('people.admission.invitedBy(Sara)');
    const accept = [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('people.admission.accept'));
    await act(async () => accept?.click());
    await flush();
    expect(mocks.accept).toHaveBeenCalledWith('inv-1');
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/projects/$projectId', params: { projectId: 'p-1' } });
  });

  it('asks a different account to switch, and offers no Accept', async () => {
    signedIn('other@example.test');
    mocks.invitation.mockResolvedValue(invitation);
    await render(<AcceptInvitationView invitationId="inv-1" />);
    expect(host.textContent).toContain('people.admission.wrongAccount(lina@example.test|other@example.test)');
    expect(buttons()).not.toContain('people.admission.accept');
  });

  it('offers "Open" on a used invitation only to a current member', async () => {
    signedIn();
    mocks.invitation.mockResolvedValue({ ...invitation, status: 'accepted' });
    mocks.switcher.mockResolvedValue({ organizations: [{ id: 'org-1', slug: 'acme', orgRole: 'member' }], recent: [], landing: null });
    await render(<AcceptInvitationView invitationId="inv-1" />);
    expect(heading()).toBe('people.admission.used');
    expect(buttons()).toContain('people.admission.openOrg(Acme)');
  });
});

describe('join link page', () => {
  const preview = {
    organizationId: 'org-1',
    organizationName: 'Acme',
    organizationLogo: null,
    inviterName: 'Sara',
    siteName: 'Docs',
    role: 'viewer',
    grants: [{ projectId: 'p-1', name: 'Docs', role: 'viewer' }],
    allowedDomain: null,
  };

  it('tells the owner they are already a member and offers to open the site instead of joining', async () => {
    signedIn('owner@example.test');
    mocks.preview.mockResolvedValue(preview);
    mocks.switcher.mockResolvedValue({ organizations: [{ id: 'org-1', slug: 'acme', orgRole: 'owner' }], recent: [], landing: null });
    await render(<JoinLinkView token={TOKEN} />);
    expect(heading()).toBe('people.admission.alreadyMember(Acme)');
    expect(buttons()).toContain('people.admission.openSite(Docs)');
    expect(buttons().some((label) => label?.startsWith('people.admission.joinButton'))).toBe(false);
  });

  it('names the org once, not "Join as Editor" plus "(Editor)" (WORKSPACE-12)', async () => {
    signedIn();
    mocks.preview.mockResolvedValue(preview);
    await render(<JoinLinkView token={TOKEN} />);
    expect(heading()).toBe('people.admission.join(Acme)');
    expect(buttons()).toContain('people.admission.joinButton(Acme)');
    expect(host.textContent).not.toContain('join.offer');
    expect(host.textContent?.split('roles.viewer').length).toBe(2);
  });

  it('says up front when the address is outside the allowed domain', async () => {
    signedIn('lina@elsewhere.test');
    mocks.preview.mockResolvedValue({ ...preview, allowedDomain: 'example.test' });
    await render(<JoinLinkView token={TOKEN} />);
    expect(host.textContent).toContain('people.admission.wrongDomain(example.test|lina@elsewhere.test)');
    expect(buttons()).toContain('people.admission.useAnotherAccount');
  });

  it('one invalid state for an unusable link', async () => {
    signedIn();
    mocks.preview.mockRejectedValue(new ApiResponseError('invalid', 404, 'join:invalid'));
    await render(<JoinLinkView token={TOKEN} />);
    expect(heading()).toBe('people.admission.invalidLink');
    expect(buttons()).toContain('people.admission.goToApp');
  });
});

describe('nameless admission journeys', () => {
  it.each(['invitation', 'join-link'])('finishes %s admission before the next dashboard name gate', async (flow) => {
    mocks.session.mockReturnValue({ data: { user: { id: 'u-1', email: 'lina@example.test', name: '' } }, isPending: false });
    const events: string[] = [];
    mocks.navigate.mockImplementation(async () => {
      events.push('dashboard');
    });
    const landing = { organizationId: 'org-1', landing: { projectId: 'p-1' } };
    if (flow === 'invitation') {
      mocks.invitation.mockResolvedValue(invitation);
      mocks.accept.mockImplementation(async () => {
        events.push('accepted');
        return landing;
      });
      await render(<AcceptInvitationView invitationId="inv-1" />);
    } else {
      mocks.preview.mockResolvedValue({
        organizationId: 'org-1',
        organizationName: 'Acme',
        organizationLogo: null,
        inviterName: 'Sara',
        siteName: 'Docs',
        role: 'viewer',
        grants: invitation.grants,
        allowedDomain: null,
      });
      mocks.join.mockImplementation((_token: string, callbacks: { onSuccess: (value: unknown) => Promise<void> }) => {
        events.push('accepted');
        void callbacks.onSuccess(landing);
      });
      await render(<JoinLinkView token={TOKEN} />);
    }
    expect(events).toEqual([]);
    const action = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.startsWith(flow === 'invitation' ? 'people.admission.accept' : 'people.admission.joinButton'),
    );
    expect(action).toBeTruthy();
    await act(async () => action?.click());
    await flush();
    expect(events).toEqual(['accepted', 'dashboard']);
    const beforeLoad = DashboardRoute.options.beforeLoad as (ctx: {
      context: { queryClient: unknown };
      location: { href: string };
    }) => Promise<unknown>;
    await expect(beforeLoad({ context: { queryClient: {} }, location: { href: '/app/projects/p-1' } })).rejects.toEqual({
      redirect: { to: '/welcome/name', search: { redirect: '/app/projects/p-1' } },
    });
    mocks.navigate.mockReset();
  });
});
