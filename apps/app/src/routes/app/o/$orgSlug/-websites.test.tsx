// @vitest-environment jsdom
import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Organization = {
  id: string;
  slug: string;
  name: string;
  logo: null;
  orgRole: 'owner' | 'admin' | 'member';
  canCreateWebsite: boolean;
  administrators?: Array<{ name: string }>;
};

const mocks = vi.hoisted(() => ({
  organization: {} as Organization,
  projects: [] as Array<Record<string, unknown>>,
  projectsPending: false,
  newSite: undefined as boolean | undefined,
  navigate: vi.fn(),
  dialog: vi.fn(),
  projectsFor: vi.fn(),
}));

const echo = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${Object.values(vars).join('|')})` : key);
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => echo,
  useLocale: () => ({ locale: 'en', t: echo }),
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => ({ newSite: mocks.newSite }) }),
  useNavigate: () => mocks.navigate,
  Link: ({ children, to, params, className }: { children: ReactNode; to: string; params?: { projectId: string }; className?: string }) => (
    <a className={className} href={to.replace('$projectId', params?.projectId ?? '')}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/organization/organization-context', () => ({
  useCurrentOrganization: () => mocks.organization,
  isOrgAdmin: (organization: Organization) => organization.orgRole !== 'member',
}));
vi.mock('@/components/app/new-project-dialog', () => ({
  NewProjectDialog: (props: { open: boolean; organizationId: string; organizationName?: string }) => {
    mocks.dialog(props);
    return <div data-open={String(props.open)} data-organization={props.organizationId} data-testid="new-project-dialog" />;
  },
}));
vi.mock('@/components/app/start-here', () => ({
  NO_REQUESTS: { deploymentSiteIds: [], pageSiteIds: [] },
  readStartHereDismissed: () => true,
  StartHere: () => null,
  startHereDismissedKey: () => null,
  subscribeToHydration: () => () => undefined,
  useStartHereActivity: () => new Map(),
}));
vi.mock('@/hooks/api', () => ({
  useOrganizationProjects: (id: string) => {
    mocks.projectsFor(id);
    return mocks.projectsPending ? { isPending: true } : { data: mocks.projects, isPending: false, isSuccess: true };
  },
  useOrganizationAnalytics: () => ({ isSuccess: false }),
  useProjectMembers: () => ({ data: undefined }),
}));
vi.mock('@/hooks/api/organization-query-options', () => ({
  organizationProjectsQueryOptions: (id: string) => ({ queryKey: ['organizations', id, 'projects', 'list'] }),
  organizationAnalyticsQueryOptions: (id: string) => ({ queryKey: ['organizations', id, 'analytics'] }),
}));
vi.mock('@/hooks/api/analytics/query-options', () => ({ analyticsTimezone: () => 'UTC' }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'user-1' } } }) }));

import { Route } from './websites';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const WebsitesPage = Route.options.component as unknown as ComponentType;
let root: ReturnType<typeof createRoot>;

const organization = (orgRole: Organization['orgRole'], administrators?: Array<{ name: string }>): Organization => ({
  id: 'org-1',
  slug: 'acme',
  name: 'Acme Docs',
  logo: null,
  orgRole,
  canCreateWebsite: orgRole !== 'member',
  administrators,
});
const project = (id: string, name: string, role: string) => ({
  id,
  name,
  slug: id,
  domain: null,
  icon: null,
  description: null,
  live: true,
  role,
  _count: { pages: 3 },
  updatedAt: '2026-11-01T00:00:00.000Z',
});

beforeEach(() => {
  mocks.organization = organization('owner');
  mocks.projects = [];
  mocks.projectsPending = false;
  mocks.newSite = undefined;
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
  await act(async () => root.render(<WebsitesPage />));
  return host;
}
// The page header's only action is "New website".
const newWebsite = (host: HTMLElement) => host.querySelector('[data-slot="page-header"] button');
const buttonWith = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find((button) => button.textContent?.includes(text));

describe('organization Websites page', () => {
  it.each(['owner', 'admin'] as const)('%s: New website button and a "create your first website" empty state', async (role) => {
    mocks.organization = organization(role);
    const host = await render();
    expect(mocks.projectsFor).toHaveBeenCalledWith('org-1');
    expect(newWebsite(host)).not.toBeNull();
    expect(host.textContent).toContain('organization.websites.emptyAdminTitle');
    expect(host.textContent).toContain('organization.websites.emptyAdmin(Acme Docs)');
    const createFirst = buttonWith(host, 'organization.websites.createFirst');
    expect(createFirst).toBeDefined();
    await act(async () => createFirst?.click());
    expect(mocks.navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '.', replace: false }));
    const [{ search }] = mocks.navigate.mock.calls[0] as [{ search: (prev: object) => object }];
    expect(search({})).toEqual({ newSite: true });
  });

  it('passes the organization to the New website dialog, opened by ?newSite', async () => {
    mocks.newSite = true;
    const host = await render();
    const dialog = host.querySelector<HTMLElement>('[data-testid="new-project-dialog"]');
    expect(dialog?.dataset.organization).toBe('org-1');
    expect(dialog?.dataset.open).toBe('true');
    expect(mocks.dialog).toHaveBeenLastCalledWith(expect.objectContaining({ organizationId: 'org-1', organizationName: 'Acme Docs', open: true }));
  });

  it('a Member with no websites sees who to ask, and no create affordances', async () => {
    mocks.organization = organization('member', [{ name: 'Sara' }, { name: 'Omar' }]);
    const host = await render();
    expect(host.textContent).toContain('organization.websites.emptyMember(Acme Docs)');
    expect(host.textContent).toContain('organization.websites.emptyMemberAsk(Saraorganization.websites.nameSeparatorOmar)');
    expect(newWebsite(host)).toBeNull();
    expect(host.textContent).not.toContain('organization.websites.createFirst');
    expect(host.querySelector('[data-testid="new-project-dialog"]')).toBeNull();
  });

  it('a Member without listed administrators gets the empty state without the ask line', async () => {
    mocks.organization = organization('member');
    const host = await render();
    expect(host.textContent).toContain('organization.websites.emptyMember(Acme Docs)');
    expect(host.textContent).not.toContain('organization.websites.emptyMemberAsk');
  });

  it('a Member sees their role on each website card', async () => {
    mocks.organization = organization('member');
    mocks.projects = [project('docs', 'Developer docs', 'viewer'), project('api', 'API reference', 'member')];
    const host = await render();
    const cards = [...host.querySelectorAll('li')];
    expect(cards).toHaveLength(2);
    expect(cards[0]?.querySelector('a')?.getAttribute('href')).toBe('/app/projects/docs');
    expect(cards[0]?.querySelector('[data-role]')?.textContent).toBe('roles.viewer');
    expect(cards[1]?.querySelector('[data-role]')?.textContent).toBe('roles.editor');
  });

  it.each(['owner', 'admin'] as const)('%s does not get role badges on cards', async (role) => {
    mocks.organization = organization(role);
    mocks.projects = [project('docs', 'Developer docs', 'admin'), project('api', 'API reference', 'owner')];
    const host = await render();
    expect(host.querySelectorAll('li')).toHaveLength(2);
    expect(host.querySelector('[data-role]')).toBeNull();
    expect(host.textContent).not.toContain('organization.websites.emptyAdminTitle');
  });

  it('shows a busy skeleton while websites load', async () => {
    mocks.projectsPending = true;
    const host = await render();
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(host.textContent).not.toContain('organization.websites.emptyAdminTitle');
  });
});
