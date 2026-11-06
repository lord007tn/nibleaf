// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ projects: vi.fn(), analytics: vi.fn(), members: vi.fn(), refetch: vi.fn(), navigate: vi.fn() }));
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
    expect(window.localStorage.getItem('nibleaf.startHere.dismissed')).toBe('1');
  });
});
