// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pending = { data: undefined, isPending: true };
const analytics = vi.hoisted(() => ({ hook: vi.fn(), chart: vi.fn() }));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useParams: () => ({ projectId: 'project-1' }) }),
  Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <a className={className} href="/link">
      {children}
    </a>
  ),
}));
vi.mock('@/env', () => ({ env: {} }));
vi.mock('@/hooks/api', () => ({
  friendlyErrorMessage: (_t: unknown, _error: unknown, key: string) => key,
  useDeployments: () => pending,
  useDomains: () => pending,
  usePages: () => pending,
  useProject: () => pending,
  useProjectMembers: () => pending,
  usePublishAnyway: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/api/analytics', () => ({
  analyticsTimezone: () => 'Asia/Riyadh',
  // Same key as the real factory (queryKeys.analytics.project).
  projectAnalyticsQueryOptions: (projectId: string, range: string, timezone: string) => ({
    queryKey: ['analytics', 'project', projectId, range, timezone],
  }),
  useProjectAnalytics: analytics.hook,
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
