// @vitest-environment jsdom
import type { AnalyticsInsightsQuery } from '@nibleaf/validators';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ overview: vi.fn(), page: vi.fn() }));
vi.mock('@/services/api', () => ({
  api: { app: { projects: { ':projectId': { analytics: { insights: { overview: { $get: mocks.overview }, page: { $get: mocks.page } } } } } } },
}));

import { overviewInsightsQueryOptions, pageInsightsQueryOptions, useOverviewInsights, usePageInsights } from './insights';
import { analyticsQueryKeys } from './query-keys';

const respond = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) });
const never = () => new Promise<never>(() => undefined);
const query = (range: AnalyticsInsightsQuery['range']): AnalyticsInsightsQuery => ({ range, timezone: 'UTC', compare: 'previous' });

let client: QueryClient;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.clearAllMocks();
});

type Probe = { data?: unknown; isPending: boolean; isPlaceholderData: boolean };
const read = (): Probe => JSON.parse(container.textContent ?? '{}');

function OverviewProbe({ range }: { range: AnalyticsInsightsQuery['range'] }) {
  const result = useOverviewInsights('p1', query(range));
  return <output>{JSON.stringify({ data: result.data, isPending: result.isPending, isPlaceholderData: result.isPlaceholderData })}</output>;
}

function PageProbe({ range, path }: { range: AnalyticsInsightsQuery['range']; path: string }) {
  const result = usePageInsights('p1', query(range), path);
  return <output>{JSON.stringify({ data: result.data, isPending: result.isPending, isPlaceholderData: result.isPlaceholderData })}</output>;
}

const show = async (element: React.ReactElement) => {
  await act(async () => root.render(<QueryClientProvider client={client}>{element}</QueryClientProvider>));
  // Let resolved fetches settle and re-render (a few macrotask turns).
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

describe('insights query factories', () => {
  it('key every endpoint and filter with analyticsQueryKeys and keep the 30 s default freshness', () => {
    const options = overviewInsightsQueryOptions('p1', query('7d'));
    expect(options.queryKey).toEqual(analyticsQueryKeys.insights('p1', 'overview', query('7d')));
    expect(options.queryKey.slice(0, 3)).toEqual([...analyticsQueryKeys.insightsForProject('p1')]);
    // No per-query override: the server caches insights for 30 s, the client default.
    expect(options.staleTime).toBeUndefined();
    expect(pageInsightsQueryOptions('p1', query('7d'), 'guide').queryKey).toEqual(analyticsQueryKeys.insights('p1', 'page', query('7d'), 'guide'));
  });

  it('does not fetch a page drill-down without a path', async () => {
    await show(<PageProbe path="" range="30d" />);
    expect(mocks.page).not.toHaveBeenCalled();
    expect(read().isPending).toBe(true);
  });
});

describe('switching the range', () => {
  it('keeps the previous range on screen while the next one loads', async () => {
    mocks.overview.mockResolvedValueOnce(respond({ range: '30d' })).mockImplementationOnce(never);
    await show(<OverviewProbe range="30d" />);
    expect(read()).toEqual({ data: { range: '30d' }, isPending: false, isPlaceholderData: false });

    await show(<OverviewProbe range="7d" />);
    expect(mocks.overview).toHaveBeenCalledTimes(2);
    // The 7-day request is still pending, yet the 30-day figures stay (no skeleton, no blank chart).
    expect(read()).toEqual({ data: { range: '30d' }, isPending: false, isPlaceholderData: true });
  });

  it('keeps a drill-down on screen for the same page only', async () => {
    mocks.page.mockResolvedValueOnce(respond({ path: 'guide' })).mockImplementation(never);
    await show(<PageProbe path="guide" range="30d" />);
    expect(read().data).toEqual({ path: 'guide' });

    await show(<PageProbe path="guide" range="7d" />);
    expect(read()).toEqual({ data: { path: 'guide' }, isPending: false, isPlaceholderData: true });

    // Another page's numbers would mislead: show the first-load state instead.
    await show(<PageProbe path="other" range="7d" />);
    expect(read()).toEqual({ isPending: true, isPlaceholderData: false });
  });
});
