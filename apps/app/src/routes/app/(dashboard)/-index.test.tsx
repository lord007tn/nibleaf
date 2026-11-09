// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  projects: vi.fn(),
  analytics: vi.fn(),
  members: vi.fn(),
  refetch: vi.fn(),
  navigate: vi.fn(),
  /** Cached data per query key (joined with '/'), standing in for the deployments/pages requests. */
  queryData: new Map<string, unknown>(),
  /** Query keys (joined with '/') whose request failed after retries, with nothing cached. */
  failed: new Set<string>(),
  /** Every key the page asked `useQueries` for, across renders. */
  requested: new Set<string>(),
  userId: 'user-1' as string | undefined,
}));
vi.mock('@tanstack/react-query', () => ({
  useQueries: ({ queries }: { queries: Array<{ queryKey: readonly unknown[] }> }) =>
    queries.map((query) => {
      mocks.requested.add(query.queryKey.join('/'));
      const key = query.queryKey.join('/');
      return { data: mocks.queryData.get(key), isError: mocks.failed.has(key) };
    }),
}));
vi.mock('@/services/api', () => ({ api: {} }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: mocks.userId ? { user: { id: mocks.userId } } : null }) }));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => ({}) }),
  useNavigate: () => mocks.navigate,
  Link: ({
    to,
    params,
    children,
    className,
    'aria-label': ariaLabel,
  }: {
    to: string;
    params?: { projectId: string };
    children?: ReactNode;
    className?: string;
    'aria-label'?: string;
  }) => (
    <a aria-label={ariaLabel} className={className} href={to.replace('$projectId', params?.projectId ?? '')}>
      {children}
    </a>
  ),
}));
vi.mock('@/hooks/api/query-options', () => ({
  projectsQueryOptions: () => ({ queryKey: ['projects'] }),
  // Same keys as the real factories (queryKeys.deployments.all / queryKeys.pages.all).
  deploymentsQueryOptions: (projectId: string) => ({ queryKey: ['deployments', projectId] }),
  pagesQueryOptions: (projectId: string) => ({ queryKey: ['pages', projectId, null, null] }),
}));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@/hooks/api/analytics/query-options', () => ({
  analyticsTimezone: () => 'Asia/Riyadh',
  // Same key as the real factory (queryKeys.analytics.workspace).
  workspaceAnalyticsQueryOptions: (range: string, timezone: string) => ({ queryKey: ['analytics', 'workspace', range, timezone] }),
}));
vi.mock('@/hooks/api', () => ({
  useProjects: mocks.projects,
  useWorkspaceAnalytics: mocks.analytics,
  useProjectMembers: mocks.members,
  useCreateProject: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/components/analytics/views-area-chart', () => ({ ViewsAreaChart: () => <div data-testid="views-chart" /> }));
vi.mock('@/lib/first-publish-activation', () => ({ recordFirstPublishStage: vi.fn() }));

import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { Route } from './index';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const DashboardPage = Route.options.component as unknown as ComponentType;

describe('dashboard request recovery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.projects.mockReturnValue({
      isPending: false,
      data: [{ id: 'project-1', name: 'Docs', slug: 'docs', _count: { pages: 3, deployments: 1 }, livePublishes: 1, publishing: false }],
      refetch: mocks.refetch,
    });
    mocks.analytics.mockReturnValue({
      isPending: false,
      data: { totalViews: 0, uniqueVisitors: 0, timeseries: [], byProject: [], availability: 'complete' },
      refetch: mocks.refetch,
    });
    mocks.members.mockReturnValue({ data: { members: [{ id: 'owner' }], invitations: [] } });
    mocks.queryData.clear();
    mocks.failed.clear();
    mocks.requested.clear();
    mocks.userId = 'user-1';
    window.localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('does not imply an empty account or zero analytics after failed initial requests', async () => {
    mocks.projects.mockReturnValue({ isPending: false, isError: true, refetch: mocks.refetch });
    mocks.analytics.mockReturnValue({ isPending: false, isError: true, refetch: mocks.refetch });
    await act(async () => root.render(<DashboardPage />));

    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2);
    expect(container.textContent).not.toContain('dashboard.empty.title');
    expect(container.querySelectorAll('[data-slot="card-title"]')).toHaveLength(4);
    expect([...container.querySelectorAll('[data-slot="card-title"]')].map((card) => card.textContent)).toEqual(['—', '—', '—', '—']);
    expect(container.querySelector('[data-testid="views-chart"]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[role="alert"] button')?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('prefetches the workspace analytics the page opens with, in the loader', async () => {
    const queryClient = {};
    (Route.options.loader as (context: { context: { queryClient: unknown } }) => void)({ context: { queryClient } });
    expect(prefetchRouteData).toHaveBeenCalledWith(queryClient, { queryKey: ['analytics', 'workspace', '30d', 'Asia/Riyadh'] });
    await act(async () => root.render(<DashboardPage />));
    // The page reads the same range (the hook adds the same browser timezone).
    expect(mocks.analytics).toHaveBeenCalledWith('30d');
  });

  it('uses a native link so a site is reachable by keyboard and browser link actions', async () => {
    await act(async () => root.render(<DashboardPage />));

    expect(container.querySelector('a[href="/app/projects/project-1"]')?.textContent).toContain('Docs');
  });

  it('keeps unavailable analytics unknown even when the endpoint returns a successful response', async () => {
    mocks.analytics.mockReturnValue({
      isPending: false,
      data: { totalViews: 0, uniqueVisitors: 0, timeseries: [], byProject: [], availability: 'unavailable' },
      isFetching: false,
      refetch: mocks.refetch,
    });
    await act(async () => root.render(<DashboardPage />));

    const values = [...container.querySelectorAll('[data-slot="card-title"]')].map((card) => card.textContent);
    expect(values.slice(2)).toEqual(['—', '—']);
    expect(container.textContent).toContain('overview.traffic.unavailable.title');
    expect(container.querySelector('[data-testid="views-chart"]')).toBeNull();
    // An outage is retried in place, like a failed request.
    const alert = [...container.querySelectorAll('[role="alert"]')].find((element) =>
      element.textContent?.includes('overview.traffic.unavailable.title'),
    );
    await act(async () => alert?.querySelector<HTMLButtonElement>('button')?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('says which traffic figures are incomplete, not AI token or cost values, and keeps them unknown', async () => {
    mocks.analytics.mockReturnValue({
      isPending: false,
      data: { totalViews: null, uniqueVisitors: 12, timeseries: [], byProject: [], availability: 'partial' },
    });
    await act(async () => root.render(<DashboardPage />));
    expect(container.textContent).toContain('overview.traffic.partial.title');
    expect(container.textContent).toContain('overview.traffic.partial.body');
    expect(container.textContent).not.toContain('analytics.state.partial');
    const values = [...container.querySelectorAll('[data-slot="card-title"]')].map((card) => card.textContent);
    expect(values[2]).toBe('—');
  });

  it('leads a brand-new user with a Start here path instead of empty analytics', async () => {
    mocks.projects.mockReturnValue({
      isPending: false,
      data: [
        {
          id: 'sample',
          name: 'Documentation',
          description: 'Your first documentation site.',
          slug: 'docs',
          createdAt: '2026-11-01T00:00:00.000Z',
          _count: { pages: 6, deployments: 1 },
          livePublishes: 0,
        },
      ],
      refetch: mocks.refetch,
    });
    mocks.queryData.set('deployments/sample', [
      { version: 1, status: 'READY', commitMessage: 'Publish starter site', createdAt: '2026-11-01T00:00:02.000Z' },
    ]);
    mocks.queryData.set('pages/sample//', [{ updatedAt: '2026-11-01T00:00:01.000Z' }]);
    await act(async () => root.render(<DashboardPage />));

    expect(container.textContent).toContain('dashboard.start.title');
    expect(container.textContent).toContain('dashboard.start.sample');
    expect(container.textContent).toContain('dashboard.start.progress {"done":0,"total":3}');
    // Step links open the sample site's editor and members settings.
    expect(container.querySelector('a[aria-label="dashboard.start.step1"]')?.getAttribute('href')).toBe('/app/projects/sample/editor');
    expect(container.querySelector('a[aria-label="dashboard.start.step3"]')?.getAttribute('href')).toBe('/app/projects/sample/settings');
    // No zero-filled KPI cards or chart before anything is published.
    expect(container.querySelectorAll('[data-slot="card-title"]')).toHaveLength(0);
    expect(container.querySelector('[data-testid="views-chart"]')).toBeNull();
    // Sites are still listed.
    expect(container.querySelector('a[href="/app/projects/sample"]')).not.toBeNull();
  });

  it('marks finished steps and hides the path once dismissed', async () => {
    await act(async () => root.render(<DashboardPage />));
    // The default site published once: writing and publishing are done, inviting is not.
    expect(container.textContent).toContain('dashboard.start.progress {"done":2,"total":3}');
    expect(container.querySelector('[data-testid="views-chart"]')).not.toBeNull();

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="overview.nudge.dismiss"]')?.click());
    expect(container.textContent).not.toContain('dashboard.start.title');
    expect(window.localStorage.getItem('nibleaf.startHere.dismissed.user-1')).toBe('1');
  });

  it('keeps a dismissal to the person who dismissed it', async () => {
    window.localStorage.setItem('nibleaf.startHere.dismissed.someone-else', '1');
    await act(async () => root.render(<DashboardPage />));
    expect(container.textContent).toContain('dashboard.start.title');

    await act(async () => root.unmount());
    root = createRoot(container);
    window.localStorage.setItem('nibleaf.startHere.dismissed.user-1', '1');
    await act(async () => root.render(<DashboardPage />));
    expect(container.textContent).not.toContain('dashboard.start.title');
  });

  it('does not count a publish that never went live as publishing', async () => {
    mocks.projects.mockReturnValue({
      isPending: false,
      data: [{ id: 'project-1', name: 'Docs', slug: 'docs', _count: { pages: 3, deployments: 2 }, livePublishes: 0, publishing: false }],
      refetch: mocks.refetch,
    });
    await act(async () => root.render(<DashboardPage />));

    // Writing is done (the site has pages); publishing is not, so no analytics yet.
    expect(container.textContent).toContain('dashboard.start.progress {"done":1,"total":3}');
    expect(container.querySelector('[data-testid="views-chart"]')).toBeNull();
  });

  it('ticks writing once the user edits the sample site', async () => {
    mocks.projects.mockReturnValue({
      isPending: false,
      data: [
        {
          id: 'sample',
          name: 'Documentation',
          description: 'Your first documentation site.',
          slug: 'docs',
          createdAt: '2026-11-01T00:00:00.000Z',
          _count: { pages: 6, deployments: 1 },
          livePublishes: 0,
        },
      ],
      refetch: mocks.refetch,
    });
    mocks.queryData.set('deployments/sample', [
      { version: 1, status: 'READY', commitMessage: 'Publish starter site', createdAt: '2026-11-01T00:00:02.000Z' },
    ]);
    mocks.queryData.set('pages/sample//', [{ updatedAt: '2026-11-01T00:00:01.000Z' }, { updatedAt: '2026-11-01T00:10:00.000Z' }]);
    await act(async () => root.render(<DashboardPage />));

    expect(container.textContent).toContain('dashboard.start.progress {"done":1,"total":3}');
  });

  it('asks the sites list to keep polling while a site is publishing', async () => {
    await act(async () => root.render(<DashboardPage />));
    expect(mocks.projects).toHaveBeenCalledWith({ pollWhilePublishing: true });
  });

  it('keeps Start here hidden until every step is known, so a finished checklist never flashes in', async () => {
    // The team is still loading: nothing about the checklist is shown yet…
    mocks.members.mockReturnValue({ data: undefined, isPending: true });
    await act(async () => root.render(<DashboardPage />));
    expect(container.textContent).not.toContain('dashboard.start.title');
    // …but analytics don't wait for it: the sites list already says something went live.
    expect(container.querySelector('[data-testid="views-chart"]')).not.toBeNull();
    // Publishing is settled by the sites list, so no publish history is read.
    expect([...mocks.requested].filter((key) => key.startsWith('deployments/'))).toEqual([]);
  });

  it('keeps a finished checklist closed when the team cannot be read', async () => {
    // Published and written (from the sites list); the team read failed, so "invited" is unknown, not "no".
    mocks.members.mockReturnValue({ data: undefined, isPending: false, isError: true });
    await act(async () => root.render(<DashboardPage />));
    expect(container.textContent).not.toContain('dashboard.start.title');
  });

  it("doesn't treat a failed read of the sample's pages as no edits", async () => {
    mocks.projects.mockReturnValue({
      isPending: false,
      data: [
        {
          id: 'sample',
          name: 'Documentation',
          description: 'Your first documentation site.',
          slug: 'docs',
          createdAt: '2026-11-01T00:00:00.000Z',
          _count: { pages: 6, deployments: 0 },
          livePublishes: 0,
        },
      ],
      refetch: mocks.refetch,
    });
    mocks.failed.add('pages/sample//');
    await act(async () => root.render(<DashboardPage />));
    expect(container.textContent).not.toContain('dashboard.start.title');
  });

  it('remembers a live publish on any site, however many the account has', async () => {
    const sites = Array.from({ length: 6 }, (_, index) => ({
      id: `site-${index}`,
      name: `Site ${index}`,
      slug: `site-${index}`,
      createdAt: '2026-11-02T00:00:00.000Z',
      _count: { pages: 1, deployments: 2 },
      livePublishes: index === 5 ? 1 : 0,
    }));
    mocks.projects.mockReturnValue({ isPending: false, data: sites, refetch: mocks.refetch });
    await act(async () => root.render(<DashboardPage />));

    expect(container.textContent).toContain('dashboard.start.progress {"done":2,"total":3}');
    expect(container.querySelector('[data-testid="views-chart"]')).not.toBeNull();
  });

  it('reads nothing for the checklist once it was dismissed', async () => {
    window.localStorage.setItem('nibleaf.startHere.dismissed.user-1', '1');
    mocks.projects.mockReturnValue({
      isPending: false,
      data: [
        {
          id: 'sample',
          name: 'Documentation',
          description: 'Your first documentation site.',
          slug: 'docs',
          createdAt: '2026-11-01T00:00:00.000Z',
          _count: { pages: 6, deployments: 1 },
          livePublishes: 0,
        },
      ],
      refetch: mocks.refetch,
    });
    await act(async () => root.render(<DashboardPage />));

    expect(container.textContent).not.toContain('dashboard.start.title');
    expect(mocks.requested.size).toBe(0);
    expect(mocks.members).toHaveBeenLastCalledWith(undefined);
  });
  const flatWeek = Array.from({ length: 7 }, (_, day) => ({ date: `2026-11-0${day + 1}`, views: 10 }));
  const pageViewsCard = () =>
    [...container.querySelectorAll('[data-slot="card"]')].find((card) => card.textContent?.includes('dashboard.stats.pageViews'));

  it('compares page views with the previous equal window, never the two halves of this one', async () => {
    // Seven flat days used to read "+33%" (days 4-7 vs days 1-3). Same total as before: flat.
    mocks.analytics.mockReturnValue({
      isPending: false,
      data: {
        totalViews: 70,
        comparableTotalViews: 70,
        previousTotalViews: 70,
        uniqueVisitors: 9,
        timeseries: flatWeek,
        byProject: [],
        availability: 'complete',
      },
    });
    await act(async () => root.render(<DashboardPage />));
    expect(pageViewsCard()?.textContent).toContain('analytics.delta.flatSpoken');
    expect(pageViewsCard()?.textContent).not.toContain('33');

    // A real doubling against the previous window.
    mocks.analytics.mockReturnValue({
      isPending: false,
      data: {
        totalViews: 140,
        comparableTotalViews: 140,
        previousTotalViews: 70,
        uniqueVisitors: 9,
        timeseries: flatWeek,
        byProject: [],
        availability: 'complete',
      },
    });
    await act(async () => root.render(<DashboardPage />));
    expect(pageViewsCard()?.textContent).toContain('analytics.delta.upSpoken');
    expect(pageViewsCard()?.textContent).toContain('100%');
  });

  it('shows no comparison when the previous window is unknown', async () => {
    mocks.analytics.mockReturnValue({
      isPending: false,
      data: {
        totalViews: 140,
        comparableTotalViews: 140,
        previousTotalViews: null,
        uniqueVisitors: 9,
        timeseries: flatWeek,
        byProject: [],
        availability: 'complete',
      },
    });
    await act(async () => root.render(<DashboardPage />));
    expect(pageViewsCard()?.textContent).not.toContain('analytics.vsPrevious');
    expect(pageViewsCard()?.querySelector('[data-slot="card-action"]')).toBeNull();
  });

  it('never shows a measured zero for a site while its views are still loading', async () => {
    mocks.analytics.mockReturnValue({ isPending: true, data: undefined, refetch: mocks.refetch });
    await act(async () => root.render(<DashboardPage />));
    const row = container.querySelector('a[href="/app/projects/project-1"]')?.closest('tr');
    const viewsCell = [...(row?.querySelectorAll('td') ?? [])].at(-1);
    expect(viewsCell?.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(viewsCell?.textContent).toBe('');
  });
  it('shows each site status and when it last went live, and opens New site through the URL', async () => {
    mocks.projects.mockReturnValue({
      isPending: false,
      data: [
        { id: 'live', name: 'Acme', slug: 'acme', live: true, lastPublishedAt: '2026-11-01T10:00:00.000Z', _count: { pages: 3 }, livePublishes: 2 },
        { id: 'draft', name: 'Handbook', slug: 'handbook', live: false, lastPublishedAt: null, _count: { pages: 1 }, livePublishes: 0 },
      ],
      refetch: mocks.refetch,
    });
    await act(async () => root.render(<DashboardPage />));
    const row = (id: string) => container.querySelector(`a[href="/app/projects/${id}"]`)?.closest('tr');
    expect(row('live')?.querySelector('[data-status]')?.getAttribute('data-status')).toBe('live');
    expect(row('live')?.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-01T10:00:00.000Z');
    expect(row('draft')?.querySelector('[data-status]')?.getAttribute('data-status')).toBe('notPublished');
    expect(row('draft')?.querySelector('time')).toBeNull();
    // The heading block is the shared page header, titled like the navigation.
    expect(container.querySelector('[data-slot="page-header"] h1')?.textContent).toBe('nav.overview');

    const create = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('dashboard.newProject'));
    await act(async () => create?.click());
    const call = mocks.navigate.mock.calls.at(-1)?.[0] as { search: (prev: object) => object };
    expect(call.search({ firstPublish: true })).toEqual({ firstPublish: true, newSite: true });
  });
});
