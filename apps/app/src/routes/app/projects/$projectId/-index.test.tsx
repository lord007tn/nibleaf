// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pending = { data: undefined, isPending: true };
const analytics = vi.hoisted(() => ({ hook: vi.fn(), chart: vi.fn() }));
const queries = vi.hoisted(() => ({}) as Record<'project' | 'pages' | 'members' | 'deployments' | 'domains' | 'session', unknown>);
/** The settings-access tests' name for the same mocked members and publishes. */
const navigation = queries;
/** Signed in as the `viewer` the settings-access tests give a role to. */
const viewer = { data: { user: { id: 'viewer' } }, isPending: false };

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useParams: () => ({ projectId: 'project-1' }) }),
  Link: ({
    children,
    className,
    search,
    'aria-label': ariaLabel,
  }: {
    children?: ReactNode;
    className?: string;
    search?: { section?: string };
    'aria-label'?: string;
  }) => (
    <a aria-label={ariaLabel} className={className} href={search?.section ? `/settings?section=${search.section}` : '/link'}>
      {children}
    </a>
  ),
}));
vi.mock('@/env', () => ({ env: {} }));
vi.mock('@/services/auth-client', () => ({ useSession: () => queries.session }));
vi.mock('@/hooks/api', async () => ({
  ...(await vi.importActual<object>('@/hooks/api/domain-state')),
  friendlyErrorMessage: (_t: unknown, _error: unknown, key: string) => key,
  useDeployments: () => queries.deployments,
  useDomains: () => queries.domains,
  usePages: () => queries.pages,
  useProject: () => queries.project,
  useProjectMembers: () => queries.members,
  usePublishAnyway: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/api/analytics', () => ({ useProjectAnalytics: analytics.hook }));
vi.mock('@/hooks/api/analytics/query-options', () => ({
  analyticsTimezone: () => 'Asia/Riyadh',
  // Same key as the real factory (queryKeys.analytics.project).
  projectAnalyticsQueryOptions: (projectId: string, range: string, timezone: string) => ({
    queryKey: ['analytics', 'project', projectId, range, timezone],
  }),
}));
vi.mock('@/hooks/api/query-options', () => ({ domainsQueryOptions: vi.fn(), projectMembersQueryOptions: vi.fn() }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@/components/analytics/views-area-chart', () => ({
  ViewsAreaChart: (props: { unavailable?: boolean }) => {
    analytics.chart(props);
    return null;
  },
}));

import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { Route } from './index';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const SiteOverviewPage = Route.options.component as unknown as ComponentType;

describe('site overview first load', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    navigation.members = pending;
    navigation.deployments = pending;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    analytics.hook.mockReturnValue(pending);
    Object.assign(queries, { project: pending, pages: pending, members: pending, deployments: pending, domains: pending, session: viewer });
  });

  it.each(['member', 'admin', 'owner'])('keeps overview settings links within the %s role', async (role) => {
    navigation.members = { isPending: false, data: { members: [{ role, user: { id: 'viewer' } }] } };
    navigation.deployments = { isPending: false, data: [] };
    await act(async () => root.render(<SiteOverviewPage />));
    const sections = [...container.querySelectorAll('a[href^="/settings"]')].map((link) =>
      new URL(link.getAttribute('href') ?? '', 'https://example.test').searchParams.get('section'),
    );
    if (role === 'member') {
      expect(sections).toContain('languages');
      expect(sections.every((section) => ['members', 'languages'].includes(section ?? ''))).toBe(true);
      expect(container.textContent).toContain('overview.settings.askAdmin');
    } else {
      expect(sections).toEqual(expect.arrayContaining(['members', 'integrations', 'plan', 'general', 'domain']));
    }
  });

  it('shows neutral placeholders until the role resolves without an Editor explanation', async () => {
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.textContent).not.toContain('overview.settings.askAdmin');
    expect(container.querySelector('a[href="/settings?section=languages"]')).toBeNull();
    navigation.members = { data: { members: [{ role: 'admin', user: { id: 'viewer' } }] } };
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.querySelector('a[href="/settings?section=general"]')).not.toBeNull();
  });
  it('offers Retry when permissions fail instead of an Editor explanation or settings link', async () => {
    const retry = vi.fn();
    navigation.members = { isError: true, refetch: retry };
    navigation.deployments = { data: [] };
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.textContent).not.toContain('overview.settings.askAdmin');
    expect(container.querySelector('a[href="/settings?section=languages"]')).toBeNull();
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(alert?.closest('ol')).toBeNull();
    await act(async () => alert?.querySelector('button')?.click());
    expect(retry).toHaveBeenCalledOnce();
  });

  it('keeps checklist steps 1 and 2 usable while permissions load, gating only the optional domain step', async () => {
    navigation.deployments = { data: [], isPending: false };
    navigation.members = pending;
    await act(async () => root.render(<SiteOverviewPage />));
    const checklist = container.querySelector('ol');
    expect(checklist).not.toBeNull();
    expect(checklist?.querySelector('a[aria-label="overview.nudge.step1"]')).not.toBeNull();
    expect(checklist?.querySelector('a[aria-label="overview.nudge.step2"]')).not.toBeNull();
    expect(checklist?.querySelector('a[aria-label="overview.nudge.step3"]')).toBeNull();
    expect(checklist?.textContent).toContain('overview.nudge.step3Desc');
    expect(checklist?.textContent).not.toContain('overview.settings.askAdmin');
    navigation.members = { data: { members: [{ role: 'admin', user: { id: 'viewer' } }] }, isPending: false };
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.querySelector('ol a[href="/settings?section=domain"]')).not.toBeNull();
  });

  it('keeps checklist steps 1 and 2 usable after a permission failure and offers Retry inside step 3', async () => {
    const retry = vi.fn();
    navigation.deployments = { data: [], isPending: false };
    navigation.members = { isPending: false, isError: true, refetch: retry };
    await act(async () => root.render(<SiteOverviewPage />));
    const checklist = container.querySelector('ol');
    expect(checklist?.querySelector('a[aria-label="overview.nudge.step1"]')).not.toBeNull();
    expect(checklist?.querySelector('a[aria-label="overview.nudge.step2"]')).not.toBeNull();
    expect(checklist?.querySelector('a[aria-label="overview.nudge.step3"]')).toBeNull();
    const step3 = checklist?.querySelectorAll('li')[2];
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(step3?.querySelector('[role="alert"], [role="status"]')).toBeNull();
    expect(step3?.textContent).toContain('overview.nudge.step3Desc');
    expect(step3?.textContent).toContain('overview.nudge.permissionsError');
    expect(step3?.textContent).not.toContain('error.title');
    expect(step3?.textContent).not.toContain('error.unexpected');
    const retryButton = step3?.querySelector('button');
    expect(retryButton?.classList.contains('text-xs')).toBe(true);
    expect(retryButton?.classList.contains('px-0')).toBe(true);
    await act(async () => retryButton?.click());
    expect(retry).toHaveBeenCalledOnce();
    navigation.members = { data: { members: [{ role: 'admin', user: { id: 'viewer' } }] }, isPending: false };
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.querySelector('ol [role="alert"]')).toBeNull();
    expect(container.querySelector('ol')?.textContent).not.toContain('overview.nudge.permissionsError');
    expect(container.querySelector('ol a[href="/settings?section=domain"]')).not.toBeNull();
  });

  it.each(['member', 'admin', 'owner'])('retains cached %s settings rows and publish nudge after a background member failure', async (role) => {
    const data = { members: [{ role, user: { id: 'viewer' } }] };
    navigation.members = { data, isPending: false };
    navigation.deployments = { data: [] };
    await act(async () => root.render(<SiteOverviewPage />));
    const settingsHref = `/settings?section=${role === 'member' ? 'languages' : 'general'}`;
    expect(container.querySelector(`a[href="${settingsHref}"]`)).not.toBeNull();
    expect(container.textContent).toContain('overview.nudge.title');
    navigation.members = { data, isPending: false, isError: true };
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.querySelector(`a[href="${settingsHref}"]`)).not.toBeNull();
    expect(container.textContent).toContain('overview.nudge.title');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    if (role !== 'member') expect(container.querySelector('a[href="/settings?section=integrations"]')).not.toBeNull();
  });

  it('prefetches the page views the overview opens with, in the loader', async () => {
    const queryClient = {};
    (Route.options.loader as (context: { context: { queryClient: unknown }; params: { projectId: string } }) => void)({
      context: { queryClient },
      params: { projectId: 'project-1' },
    });
    expect(prefetchRouteData).toHaveBeenCalledWith(queryClient, { queryKey: ['analytics', 'project', 'project-1', '30d', 'Asia/Riyadh'] });
    await act(async () => root.render(<SiteOverviewPage />));
    expect(analytics.hook).toHaveBeenCalledWith('project-1', '30d');
  });

  it('shows unknown page views, not zero, when analytics is unavailable', async () => {
    analytics.hook.mockReturnValue({ isPending: false, data: { availability: 'unavailable', totalViews: null, timeseries: [] } });
    await act(async () => root.render(<SiteOverviewPage />));
    const tiles = [...container.querySelectorAll('[data-slot="card"]')].filter((card) => card.textContent?.includes('overview.stats.pageviews'));
    expect(tiles).toHaveLength(1);
    expect(tiles[0]?.querySelector('[data-slot="card-title"]')?.textContent).toBe('—');
    // …and the chart says the views are unknown instead of "no traffic yet".
    expect(analytics.chart).toHaveBeenLastCalledWith(expect.objectContaining({ unavailable: true }));
  });

  it('treats a failed page-views request as unknown, not as no traffic', async () => {
    analytics.hook.mockReturnValue({ isPending: false, isError: true, data: undefined });
    await act(async () => root.render(<SiteOverviewPage />));
    expect(analytics.chart).toHaveBeenLastCalledWith(expect.objectContaining({ unavailable: true }));
  });

  it('announces loading once for the page and keeps the heading free of block elements', async () => {
    await act(async () => root.render(<SiteOverviewPage />));

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    // The loading regions are still marked busy.
    expect(container.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThanOrEqual(2);
    const heading = container.querySelector('h1');
    expect(heading?.textContent).toBe('overview.title');
    expect(heading?.querySelector('div')).toBeNull();
    expect(heading?.querySelector('[data-slot="skeleton"]')?.tagName).toBe('SPAN');
  });
});

const failed = () => ({ data: undefined, isPending: false, isError: true, isFetching: false, refetch: vi.fn() });
const loaded = (data: unknown) => ({ data, isPending: false, isError: false, isFetching: false, refetch: vi.fn() });
const readyDeployment = { id: 'dep-1', version: 3, status: 'READY', createdAt: '2026-11-01T00:00:00Z', completedAt: '2026-11-01T00:01:00Z' };
const domain = (patch: Record<string, unknown>) => ({
  id: 'domain-1',
  domain: 'docs.example.com',
  verified: true,
  isPrimary: true,
  dnsStatus: 'VERIFIED',
  sslStatus: 'ACTIVE',
  ...patch,
});

describe('site overview when something fails or is still connecting', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    analytics.hook.mockReturnValue({ isPending: false, data: { availability: 'available', totalViews: 0, timeseries: [] } });
    Object.assign(queries, {
      project: loaded({ id: 'project-1', name: 'Docs', slug: 'docs' }),
      pages: loaded([]),
      members: loaded({ members: [] }),
      deployments: loaded([readyDeployment]),
      domains: loaded([]),
      session: { data: { user: { id: 'user-1' } }, isPending: false },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  const tile = (label: string) =>
    [...container.querySelectorAll('[data-slot="card"]')].find((card) => card.textContent?.includes(label))?.querySelector('[data-slot="card-title"]')
      ?.textContent;
  const liveLink = () => container.querySelector<HTMLAnchorElement>('a[target="_blank"][href]:not([aria-label])');

  it('shows a retry, not "no pages yet" or zero counts, when pages and members fail to load', async () => {
    const pages = failed();
    Object.assign(queries, { pages, members: failed() });
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.textContent).not.toContain('overview.noPages');
    expect(tile('overview.stats.pages')).toBe('—');
    expect(tile('overview.stats.members')).toBe('—');
    // One Retry per failed request: the recent pages, then the settings links that need the team.
    const retry = [...container.querySelectorAll<HTMLButtonElement>('[role="alert"] button')];
    expect(retry).toHaveLength(2);
    await act(async () => retry[0]?.click());
    expect(pages.refetch).toHaveBeenCalled();
    await act(async () => retry[1]?.click());
    expect((queries.members as { refetch: () => void }).refetch).toHaveBeenCalled();
  });

  it('does not claim the site is unpublished when publishes fail to load', async () => {
    Object.assign(queries, { deployments: failed() });
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.textContent).not.toContain('overview.live.unavailable');
    expect(container.textContent).not.toContain('overview.activity.empty');
    expect(container.textContent).toContain('overview.live.loadError');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(tile('overview.stats.deploys')).toBe('—');
  });

  it('links a custom domain only once its DNS and HTTPS both work', async () => {
    queries.domains = loaded([domain({})]);
    await act(async () => root.render(<SiteOverviewPage />));
    expect(liveLink()?.getAttribute('href')).toBe('https://docs.example.com');
    expect(container.textContent).not.toContain('overview.live.domainConnecting');
  });

  it.each([
    { dnsStatus: 'ERROR', sslStatus: 'PENDING' },
    { dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING' },
  ])('keeps readers on the default address while the domain is not ready: %o', async (status) => {
    queries.domains = loaded([domain(status)]);
    await act(async () => root.render(<SiteOverviewPage />));
    expect(liveLink()?.getAttribute('href')).toBe('/sites/project-1');
    expect(container.querySelector('[aria-label="overview.viewSite"]')?.getAttribute('href')).toBe('/sites/project-1');
    expect(container.textContent).toContain('overview.live.domainConnecting');
  });

  it('explains a failed publish in plain words and keeps the raw reason folded away', async () => {
    queries.deployments = loaded([
      { ...readyDeployment, id: 'dep-2', version: 4, status: 'FAILED', error: 'Published revision exceeds export limits.' },
    ]);
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.textContent).toContain('overview.publishFailed.unknown');
    const details = container.querySelector('details');
    expect(details?.querySelector('summary')?.textContent).toBe('overview.publishFailed.technicalDetails');
    expect(details?.textContent).toContain('Published revision exceeds export limits.');
  });

  describe('the "still connecting" note fits who is looking', () => {
    const connecting = () => loaded([domain({ sslStatus: 'PROVISIONING' })]);
    const team = (role: string) => loaded({ members: [{ user: { id: 'user-1' }, role }] });

    it('offers Admins the way to finish the setup', async () => {
      Object.assign(queries, { domains: connecting(), members: team('admin') });
      await act(async () => root.render(<SiteOverviewPage />));
      expect(container.textContent).toContain('overview.live.finishSetup');
      expect(container.textContent).not.toContain('overview.live.askAdmin');
    });

    it('asks Editors to involve an Admin instead of linking a section they cannot open', async () => {
      Object.assign(queries, { domains: connecting(), members: team('member') });
      await act(async () => root.render(<SiteOverviewPage />));
      expect(container.textContent).toContain('overview.live.askAdmin');
      expect(container.textContent).not.toContain('overview.live.finishSetup');
    });

    it.each([
      ['the session is loading', { session: { data: undefined, isPending: true } }],
      ['the team is loading', { members: pending }],
      ['the team failed to load', { members: failed() }],
    ])('stays neutral while %s', async (_label, state) => {
      Object.assign(queries, { domains: connecting(), members: team('admin'), ...state });
      await act(async () => root.render(<SiteOverviewPage />));
      expect(container.textContent).toContain('overview.live.domainConnecting');
      expect(container.textContent).not.toContain('overview.live.finishSetup');
      expect(container.textContent).not.toContain('overview.live.askAdmin');
    });
  });
});
