import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { demoAnalyticsEvents } from '../../scripts/demo-data';
import { getClickHouseClient, insertAnalyticsEvents } from '../client';
import { deleteProjectAnalytics } from '../privacy';
import { readPageDetail, readPages } from './pages';
import { resolveInsightsMeta } from './period';
import {
  queryAiVisibilityInsights,
  queryFeedbackInsights,
  queryOverviewInsights,
  queryPageDetailInsights,
  queryPagesInsights,
  queryPerformanceInsights,
  querySearchInsights,
} from './queries';
import { InsightsReader, type InsightsScope } from './reader';
import { readAiVisibility, readFeedback, readOverview, readPerformance } from './reports';
import { readSearch } from './search';

const integration = process.env.CLICKHOUSE_INTEGRATION === '1' ? describe : describe.skip;
integration('insights over real deduplicated facts', () => {
  const projectId = `insights-${randomUUID()}`;
  const scope: InsightsScope = {
    tenantId: 'fictional-insights-test',
    projectId,
    visibility: 'visible',
    titles: new Map([['guides/api', 'API guide']]),
    meta: resolveInsightsMeta({ range: '7d', timezone: 'Asia/Kathmandu', compare: 'previous' }),
  };
  beforeAll(async () => {
    vi.stubEnv('ANALYTICS_MODE', 'clickhouse');
    const events = demoAnalyticsEvents(scope.tenantId, projectId, 1);
    await insertAnalyticsEvents(events);
    await insertAnalyticsEvents(events.slice(0, 12));
  }, 60_000);
  afterAll(async () => {
    await deleteProjectAnalytics(scope.tenantId, projectId);
    vi.unstubAllEnvs();
  }, 60_000);

  it('executes every SQL report without degradation', async () => {
    const reader = new InsightsReader(scope);
    expect(await reader.ready()).toBe(true);
    for (const report of [readOverview, readPages, readSearch, readFeedback, readAiVisibility, readPerformance]) {
      const result = await report(reader);
      expect(result.meta.availability).not.toBe('unavailable');
    }
    expect((await readPageDetail(reader, 'guides/api')).title).toBe('API guide');
  }, 60_000);
  it('answers all seven contracts, excludes bots, settles bursts and computes CTR', async () => {
    const overview = await queryOverviewInsights(scope);
    expect(overview.kpis.pageViews).toEqual({ value: 24, previous: 0 });
    expect(overview.kpis.visits.value).toBe(12);
    expect(overview.kpis.searches.value).toBe(15);
    const pages = await queryPagesInsights(scope);
    expect(pages.rows.find((row) => row.path === 'guides/api')?.title).toBe('API guide');
    const page = await queryPageDetailInsights(scope, 'guides/api');
    expect(page.kpis.views.value).toBe(15);
    expect(page.webVitals.samples).toBe(3);
    const search = await querySearchInsights(scope);
    expect(search.kpis.clickThroughRate.value).toBeCloseTo(12 / 15);
    expect(search.kpis.refinementRate.value).toBeCloseTo(3 / 15);
    expect(search.kpis.zeroResultRate.value).toBeCloseTo(3 / 15);
    expect(search.topTerms.map((row) => row.term)).toContain('api tokens');
    expect(search.topTerms.map((row) => row.term)).not.toContain('api');
    const feedback = await queryFeedbackInsights(scope);
    expect(feedback.kpis.helpful.value).toBe(9);
    expect(feedback.kpis.notHelpful.value).toBe(3);
    const ai = await queryAiVisibilityInsights(scope);
    expect(ai.kpis.aiCrawlerRequests.value).toBe(36);
    expect(ai.kpis.searchEngineRequests.value).toBe(12);
    expect(ai.kpis.aiAssistantVisits.value).toBe(4);
    const performance = await queryPerformanceInsights(scope);
    expect(performance.overall.samples).toBe(12);
    expect(performance.overall.clsP75).toBeGreaterThan(0);
    expect(performance.overall.rating?.poor).toBeCloseTo(0.25);
    expect((await queryOverviewInsights({ ...scope, tenantId: 'another-tenant' })).kpis.pageViews.value).toBe(0);
  }, 60_000);
  it('checks one tombstone per endpoint, returns unknown on failure/disabled reads', async () => {
    const client = getClickHouseClient();
    const spy = vi.spyOn(client, 'query');
    await queryOverviewInsights({ ...scope, client });
    expect(spy.mock.calls.filter(([arg]) => arg.query.includes('analytics_deletion_tombstones'))).toHaveLength(1);
    spy.mockRestore();
    const broken = { query: vi.fn().mockRejectedValue(new Error('unavailable')) } as unknown as typeof client;
    expect((await querySearchInsights({ ...scope, client: broken })).meta.availability).toBe('unavailable');
    vi.stubEnv('ANALYTICS_MODE', 'disabled');
    expect((await queryOverviewInsights({ ...scope, client: broken })).meta.availability).toBe('not_configured');
    vi.stubEnv('ANALYTICS_MODE', 'clickhouse');
  }, 60_000);

  it('hides every term below k distinct visits and respects a later opt-out', async () => {
    const privateScope = { ...scope, projectId: `${projectId}-privacy` };
    const events = demoAnalyticsEvents(scope.tenantId, privateScope.projectId, 1).map((event) => ({ ...event, sessionHash: 'a'.repeat(64) }));
    await insertAnalyticsEvents(events);
    try {
      const result = await querySearchInsights(privateScope);
      expect(result.topTerms).toEqual([]);
      expect(result.refinements).toEqual([]);
      expect(result.hiddenTerms.searches).toBe(result.kpis.searches.value);
      const optedOut = await querySearchInsights({ ...scope, visibility: 'disabled_by_setting' });
      expect(optedOut.topTerms).toEqual([]);
      expect(optedOut.hiddenTerms.searches).toBe(15);
    } finally {
      await deleteProjectAnalytics(privateScope.tenantId, privateScope.projectId);
    }
  }, 60_000);
});
