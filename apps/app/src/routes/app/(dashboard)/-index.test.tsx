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
  userId: 'user-1' as string | undefined,
}));
vi.mock('@tanstack/react-query', () => ({
  useQueries: ({ queries }: { queries: Array<{ queryKey: readonly unknown[] }> }) =>
    queries.map((query) => ({ data: mocks.queryData.get(query.queryKey.join('/')) })),
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
    params: { projectId: string };
    children?: ReactNode;
    className?: string;
    'aria-label'?: string;
  }) => (
    <a aria-label={ariaLabel} className={className} href={to.replace('$projectId', params.projectId)}>
      {children}
    </a>
  ),
}));
vi.mock('@/hooks/api/query-options', () => ({ projectsQueryOptions: () => ({ queryKey: ['projects'] }) }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@/hooks/api', () => ({
  useProjects: mocks.projects,
  useWorkspaceAnalytics: mocks.analytics,
  useProjectMembers: mocks.members,
  useCreateProject: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/components/analytics/views-area-chart', () => ({ ViewsAreaChart: () => <div data-testid="views-chart" /> }));
vi.mock('@/lib/first-publish-activation', () => ({ recordFirstPublishStage: vi.fn() }));

import { Route } from './index';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const DashboardPage = Route.options.component as unknown as ComponentType;

describe('dashboard request recovery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.projects.mockReturnValue({
      isPending: false,
      data: [{ id: 'project-1', name: 'Docs', slug: 'docs', _count: { pages: 3, deployments: 1 } }],
      refetch: mocks.refetch,
    });
    mocks.analytics.mockReturnValue({
      isPending: false,
      data: { totalViews: 0, uniqueVisitors: 0, timeseries: [], byProject: [], availability: 'complete' },
      refetch: mocks.refetch,
    });
    mocks.members.mockReturnValue({ data: undefined });
    mocks.queryData.clear();
    mocks.queryData.set('deployments/project-1', [{ version: 1, status: 'READY', commitMessage: null, createdAt: '2026-11-03T00:00:00.000Z' }]);
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

  it('uses a native link so a site is reachable by keyboard and browser link actions', async () => {
    await act(async () => root.render(<DashboardPage />));

    expect(container.querySelector('a[href="/app/projects/project-1"]')?.textContent).toContain('Docs');
  });

  it('keeps unavailable analytics unknown even when the endpoint returns a successful response', async () => {
    mocks.analytics.mockReturnValue({
      isPending: false,
      data: { totalViews: 0, uniqueVisitors: 0, timeseries: [], byProject: [], availability: 'unavailable' },
    });
    await act(async () => root.render(<DashboardPage />));

    const values = [...container.querySelectorAll('[data-slot="card-title"]')].map((card) => card.textContent);
    expect(values.slice(2)).toEqual(['—', '—']);
    expect(container.textContent).toContain('analytics.state.unavailable.title');
    expect(container.querySelector('[data-testid="views-chart"]')).toBeNull();
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
        },
      ],
      refetch: mocks.refetch,
    });
    mocks.members.mockReturnValue({ data: { members: [{ id: 'owner' }], invitations: [] } });
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
    mocks.members.mockReturnValue({ data: { members: [{ id: 'owner' }], invitations: [] } });
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

  it('does not count a failed publish as publishing', async () => {
    mocks.queryData.set('deployments/project-1', [{ version: 1, status: 'FAILED', commitMessage: null, createdAt: '2026-11-03T00:00:00.000Z' }]);
    mocks.members.mockReturnValue({ data: { members: [{ id: 'owner' }], invitations: [] } });
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
});
