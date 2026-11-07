// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pending = { data: undefined, isPending: true };
const analytics = vi.hoisted(() => ({ hook: vi.fn(), chart: vi.fn() }));
const queries = vi.hoisted(() => ({}) as Record<'project' | 'pages' | 'members' | 'deployments' | 'domains', unknown>);

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
    Object.assign(queries, { project: pending, pages: pending, members: pending, deployments: pending, domains: pending });
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
    const retry = [...container.querySelectorAll('[role="alert"] button')];
    expect(retry).toHaveLength(1);
    await act(async () => (retry[0] as HTMLButtonElement).click());
    expect(pages.refetch).toHaveBeenCalled();
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
});
