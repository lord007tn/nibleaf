// @vitest-environment jsdom

import { type QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ search: {} as Record<string, unknown>, fetch: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  getRouteApi: () => ({ useSearch: () => mocks.search, useParams: () => ({ projectId: 'p1' }) }),
  useNavigate: () => vi.fn(),
}));
// Any request means the section missed the prefetched entry.
vi.mock('@/services/api', () => {
  const endpoint = { $get: mocks.fetch };
  const insights = { overview: endpoint, pages: endpoint, page: endpoint, search: endpoint, feedback: endpoint, ai: endpoint, performance: endpoint };
  return { api: { app: { projects: { ':projectId': { analytics: { insights } } } } } };
});
vi.mock('@/components/analytics/insights/overview-section', () => ({ OverviewSection: () => null }));
vi.mock('@/components/analytics/insights/pages-section', () => ({ PagesSection: () => null }));
vi.mock('@/components/analytics/insights/search-section', () => ({ SearchSection: () => null }));
vi.mock('@/components/analytics/insights/feedback-section', () => ({ FeedbackSection: () => null }));
vi.mock('@/components/analytics/insights/ai-section', () => ({ AiSection: () => null }));
vi.mock('@/components/analytics/insights/performance-section', () => ({ PerformanceSection: () => null }));

import { useInsightsFilters } from '@/components/analytics/insights/use-insights-filters';
import {
  useAiVisibilityInsights,
  useFeedbackInsights,
  useOverviewInsights,
  usePageInsights,
  usePagesInsights,
  usePerformanceInsights,
  useSearchInsights,
} from '@/hooks/api/analytics/insights';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { Route as AiRoute } from './analytics.ai';
import { Route as FeedbackRoute } from './analytics.feedback';
import { Route as OverviewRoute } from './analytics.index';
import { Route as PagesRoute } from './analytics.pages';
import { Route as PerformanceRoute } from './analytics.performance';
import { Route as SearchRoute } from './analytics.search';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

interface LoaderRoute {
  options: {
    loaderDeps?: (context: { search: Record<string, unknown> }) => unknown;
    loader?: (context: { context: { queryClient: QueryClient }; params: { projectId: string }; deps: unknown }) => unknown;
  };
}

let root: Root;
let container: HTMLDivElement;

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

/** Run a route's loader the way the router does and return the keys it prefetched (stored as cache entries). */
function runLoader(route: unknown, queryClient: QueryClient, search: Record<string, unknown>) {
  const keys: QueryKey[] = [];
  vi.spyOn(queryClient, 'ensureQueryData').mockImplementation(async (options) => {
    keys.push(options.queryKey);
    queryClient.setQueryData(options.queryKey, { prefetched: true });
    return { prefetched: true };
  });
  const { loaderDeps, loader } = (route as LoaderRoute).options;
  const deps = loaderDeps?.({ search });
  loader?.({ context: { queryClient }, params: { projectId: 'p1' }, deps });
  return keys;
}

type SectionHook = (projectId: string, query: ReturnType<typeof useInsightsFilters>['query']) => { data: unknown };

/** The section's own data path: the URL filters through useInsightsFilters into its hook. */
function SectionProbe({ useSection }: { useSection: SectionHook }) {
  const { projectId, query } = useInsightsFilters();
  return <output>{JSON.stringify(useSection(projectId, query).data ?? null)}</output>;
}

const sections: Array<[string, unknown, SectionHook]> = [
  ['overview', OverviewRoute, useOverviewInsights],
  ['pages', PagesRoute, usePagesInsights],
  ['search', SearchRoute, useSearchInsights],
  ['feedback', FeedbackRoute, useFeedbackInsights],
  ['AI visibility', AiRoute, useAiVisibilityInsights],
  ['performance', PerformanceRoute, usePerformanceInsights],
  ['page drill-down', PagesRoute, (projectId, query) => usePageInsights(projectId, query, 'guide/install')],
];

const searches: Array<Record<string, unknown>> = [{}, { range: '7d', compare: 'none' }, { range: 'custom', from: '2026-01-01', to: '2026-01-31' }];

describe('analytics route loaders', () => {
  for (const [name, route, useSection] of sections) {
    for (const filters of searches) {
      it(`prefetch the exact entry the ${name} section reads (${JSON.stringify(filters)})`, async () => {
        const queryClient = createQueryClient();
        mocks.search = name === 'page drill-down' ? { ...filters, path: 'guide/install' } : filters;
        const keys = runLoader(route, queryClient, mocks.search);
        expect(keys).toHaveLength(1);

        await act(async () =>
          root.render(
            <QueryClientProvider client={queryClient}>
              <SectionProbe useSection={useSection} />
            </QueryClientProvider>,
          ),
        );
        // The section found the prefetched data under the same key: no second entry, no request.
        expect(container.textContent).toBe('{"prefetched":true}');
        expect(
          queryClient
            .getQueryCache()
            .getAll()
            .map((query) => query.queryKey),
        ).toEqual(keys);
        expect(mocks.fetch).not.toHaveBeenCalled();
      });
    }
  }

  it('ignore invalid URL filters the same way the section does', () => {
    const queryClient = createQueryClient();
    const keys = runLoader(OverviewRoute, queryClient, { range: 'forever', compare: 'sometimes' });
    expect(keys[0]).toEqual(expect.arrayContaining(['overview', '30d', 'previous']));
  });
});
