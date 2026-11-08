// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ analytics: vi.fn(), refetch: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));
vi.mock('@nibleaf/i18n/locale-state', () => ({ getLocale: () => 'en', subscribeLanguage: () => () => undefined }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/hooks/api/analytics', () => ({ useWorkspaceAnalytics: mocks.analytics }));
vi.mock('@/hooks/api/analytics/query-options', () => ({
  analyticsTimezone: () => 'Asia/Riyadh',
  workspaceAnalyticsQueryOptions: () => ({ queryKey: ['analytics', 'workspace'] }),
}));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@/providers/analytics-provider', () => ({
  AnalyticsProvider: ({ children }: { children: ReactNode }) => children,
  useAnalyticsFilters: () => ({ range: '30d', setRange: vi.fn(), timezone: 'Asia/Riyadh' }),
}));
vi.mock('@/components/analytics/views-timeseries-chart', () => ({ ViewsTimeseriesChart: () => <div data-testid="views-chart" /> }));
vi.mock('@/components/analytics/insights/search-terms', () => ({
  TermsEmptyState: ({ reason }: { reason?: string }) => <p data-terms-empty="">{reason}</p>,
}));

import { Route } from './analytics';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const AnalyticsPage = Route.options.component as unknown as ComponentType;

const workspace = (overrides: Record<string, unknown> = {}) => ({
  availability: 'complete',
  totalViews: 1200,
  previousTotalViews: 1000,
  uniqueVisitors: 300,
  timeseries: [],
  byProject: [
    { projectId: 'a', name: 'Acme', color: '#f00', views: 1200 },
    { projectId: 'b', name: 'Handbook', color: '#0f0', views: 0 },
  ],
  topPages: [],
  referrers: [],
  devices: [],
  searches: { total: 1139, zeroResults: 309, clickedResults: 513, averageLatencyMs: null, queryTerms: 'redacted', topTerms: [] },
  ai: { answersCompleted: 72, answersFailed: 0, promptTokens: 0, completionTokens: 0, costMicros: 120_138, averageLatencyMs: null },
  ...overrides,
});

const card = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('[data-slot="card"]')].find((element) => element.textContent?.includes(label));

describe('workspace analytics', () => {
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

  it('explains hidden search terms instead of claiming there were no searches', async () => {
    mocks.analytics.mockReturnValue({ isPending: false, data: workspace() });
    await act(async () => root.render(<AnalyticsPage />));
    expect(container.textContent).toContain('analytics.workspace.termsPerSite');
    expect(container.textContent).not.toContain('analytics.empty.searches');
  });

  it('keeps "no searches yet" for a workspace that really had none', async () => {
    mocks.analytics.mockReturnValue({ isPending: false, data: workspace({ searches: { total: 0, topTerms: [] } }) });
    await act(async () => root.render(<AnalyticsPage />));
    expect(container.textContent).toContain('analytics.empty.searches');
    expect(container.textContent).not.toContain('analytics.workspace.termsPerSite');
  });

  it('shows AI spend in dollars, not raw micro-units', async () => {
    mocks.analytics.mockReturnValue({ isPending: false, data: workspace() });
    await act(async () => root.render(<AnalyticsPage />));
    const cost = card(container, 'dashboard.ai.cost');
    expect(cost?.textContent).toContain('$0.12');
    expect(cost?.textContent).not.toContain('120,138');
  });

  it('keeps incomplete AI spend unknown', async () => {
    mocks.analytics.mockReturnValue({ isPending: false, data: workspace({ ai: { answersCompleted: 3, costMicros: null } }) });
    await act(async () => root.render(<AnalyticsPage />));
    expect(card(container, 'dashboard.ai.cost')?.querySelector('[data-slot="card-title"]')?.textContent).toBe('—');
  });

  it('counts sites with traffic and compares page views with the previous window', async () => {
    mocks.analytics.mockReturnValue({ isPending: false, data: workspace() });
    await act(async () => root.render(<AnalyticsPage />));
    expect(card(container, 'analytics.kpi.sitesWithTraffic')?.querySelector('[data-slot="card-title"]')?.textContent).toBe('1');
    expect(card(container, 'analytics.kpi.pageViews')?.textContent).toContain('+20%');
  });

  it('retries a failed read in place', async () => {
    mocks.analytics.mockReturnValue({ isPending: false, isError: true, isFetching: false, refetch: mocks.refetch });
    await act(async () => root.render(<AnalyticsPage />));
    await act(async () => container.querySelector<HTMLButtonElement>('[role="alert"] button')?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
