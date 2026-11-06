import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { demoAnalyticsEvents } from '../../scripts/demo-data';
import { getClickHouseClient, insertAnalyticsEvents } from '../client';
import { deleteProjectAnalytics } from '../privacy';
import { refreshProjectInsightsRollups } from '../rollups';
import { fixedAnalyticsEvent } from '../testing';
import { readInsightsProjectStatus } from './cache';
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
    const request = events.find((event) => event.payload.name === 'search_query_submitted' && event.sensitiveQueryText === 'api tokens');
    if (request?.payload.name !== 'search_query_submitted') throw new Error('Missing synthetic search fixture');
    const searchId = request.payload.searchId;
    // Ten second-result clicks must outweigh the nine first-result clicks, and
    // click-position averages must weight clicks rather than per-search means.
    await insertAnalyticsEvents(
      Array.from({ length: 10 }, () => ({
        ...request,
        eventId: randomUUID(),
        occurredAt: new Date(Date.parse(request.occurredAt) + 30_000).toISOString(),
        queryHash: null,
        sensitiveQueryText: null,
        payload: { name: 'search_result_clicked', searchId, path: 'guides/authentication', resultPosition: 4 },
      })),
    );
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
    expect(page.previousPages).toContainEqual({ path: 'introduction', clicks: 3 });
    const search = await querySearchInsights(scope);
    expect(search.kpis.clickThroughRate.value).toBeCloseTo(12 / 15);
    expect(search.kpis.refinementRate.value).toBeCloseTo(3 / 15);
    expect(search.kpis.zeroResultRate.value).toBeCloseTo(3 / 15);
    expect(search.topTerms.map((row) => row.term)).toContain('api tokens');
    expect(search.kpis.averageClickPosition.value).toBeCloseTo(2.5);
    expect(search.topTerms.find((row) => row.term === 'api tokens')?.topResultPath).toBe('guides/authentication');
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
  it('fills all count series and aligns empty previous buckets', async () => {
    const overview = await queryOverviewInsights(scope);
    expect(overview.pageViewsSeries.length).toBeGreaterThan(1);
    expect(overview.previousPageViewsSeries).toHaveLength(overview.pageViewsSeries.length);
    expect(overview.previousPageViewsSeries.every((point) => point.value === 0)).toBe(true);
    expect(overview.pageViewsSeries.some((point) => point.value === 0)).toBe(true);
    const page = await queryPageDetailInsights(scope, 'guides/api');
    expect(page.viewsSeries).toHaveLength(overview.pageViewsSeries.length);
    expect(page.feedback.series).toHaveLength(page.viewsSeries.length);
    const search = await querySearchInsights(scope);
    expect(search.searchesSeries).toHaveLength(page.viewsSeries.length);
    expect(search.zeroResultSeries).toHaveLength(page.viewsSeries.length);
    expect((await queryFeedbackInsights(scope)).series).toHaveLength(page.viewsSeries.length);
    const ai = await queryAiVisibilityInsights(scope);
    expect(ai.assistantReferralSeries).toHaveLength(page.viewsSeries.length);
    expect(ai.crawlerSeries.every((series) => series.points.length === page.viewsSeries.length)).toBe(true);
  }, 60_000);
  it('uses visit arrival channels/referrers, filters non-AI bots and retains freshness after raw erasure', async () => {
    const isolated = { ...scope, projectId: `${projectId}-regressions` };
    const start = Date.now() - 3_600_000;
    const event = (offset: number, overrides: Parameters<typeof fixedAnalyticsEvent>[0]) =>
      fixedAnalyticsEvent({
        tenantId: isolated.tenantId,
        projectId: isolated.projectId,
        eventId: randomUUID(),
        occurredAt: new Date(start + offset).toISOString(),
        receivedAt: new Date(start + offset).toISOString(),
        ...overrides,
      });
    await insertAnalyticsEvents([
      event(0, { sessionHash: 'a'.repeat(64), channel: 'search', payload: { name: 'page_view', path: 'landing', referrer: 'google.com' } }),
      event(1000, { sessionHash: 'a'.repeat(64), payload: { name: 'page_view', path: 'target' } }),
      event(2000, { sessionHash: 'a'.repeat(64), payload: { name: 'page_view', path: 'target' } }),
      event(3000, { channel: 'referral', payload: { name: 'page_view', path: 'target', referrer: 'example.org' } }),
      event(4000, {
        actorType: 'bot',
        botCategory: 'search_engine',
        payload: { name: 'crawler_request', path: 'target', resource: 'page', statusCode: 200 },
      }),
      event(5000, {
        actorType: 'bot',
        botCategory: 'ai_search',
        payload: { name: 'crawler_request', path: 'target', resource: 'page', statusCode: 200 },
      }),
    ]);
    try {
      const page = await readPageDetail(new InsightsReader(isolated), 'target');
      expect(page.channels).toEqual(
        expect.arrayContaining([
          { channel: 'search', visits: 1 },
          { channel: 'referral', visits: 1 },
        ]),
      );
      expect(page.channels).not.toContainEqual(expect.objectContaining({ channel: 'direct' }));
      expect(page.referrers).toEqual(
        expect.arrayContaining([
          { domain: 'google.com', visits: 1 },
          { domain: 'example.org', visits: 1 },
        ]),
      );
      expect((await readPages(new InsightsReader(isolated))).rows.find((row) => row.path === 'target')?.aiCrawlerRequests).toBe(1);
      const before = await readInsightsProjectStatus(isolated);
      expect(Date.parse(before.lastEventAt ?? '')).toBe(start + 3000);
      await getClickHouseClient('writer').command({
        query: 'ALTER TABLE analytics_events DELETE WHERE tenant_id = {t:String} AND project_id = {p:String}',
        query_params: { t: isolated.tenantId, p: isolated.projectId },
        clickhouse_settings: { mutations_sync: '1' },
      });
      expect(await readInsightsProjectStatus(isolated)).toEqual(before);
      await deleteProjectAnalytics(isolated.tenantId, isolated.projectId);
      expect(await readInsightsProjectStatus(isolated)).toEqual({ deleted: true, lastEventAt: null });
    } finally {
      await deleteProjectAnalytics(isolated.tenantId, isolated.projectId);
    }
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

  it('returns unknown KPI comparisons for periods outside raw retention', async () => {
    const expired = {
      ...scope,
      meta: { ...scope.meta, previous: null, current: { from: new Date(Date.now() - 200 * 86_400_000).toISOString(), to: scope.meta.current.to } },
    };
    const report = await queryAiVisibilityInsights(expired);
    expect(report.meta.availability).toBe('partial');
    expect(report.kpis.aiCrawlerRequests.value).toBeNull();
    expect(report.kpis.aiAssistantVisits.value).toBeNull();
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

  it('rebuilds duplicate-safe page/session/vital/crawler/referral snapshots', async () => {
    const client = getClickHouseClient('writer');
    await refreshProjectInsightsRollups(scope.tenantId, scope.projectId, client);
    await refreshProjectInsightsRollups(scope.tenantId, scope.projectId, client);
    const result = await client.query({
      query: `SELECT
      (SELECT sum(views) FROM analytics_pages_hourly WHERE tenant_id = {t:String} AND project_id = {p:String}) AS views,
      (SELECT count() FROM analytics_sessions WHERE tenant_id = {t:String} AND project_id = {p:String}) AS sessions,
      (SELECT sum(samples) FROM analytics_web_vitals_hourly WHERE tenant_id = {t:String} AND project_id = {p:String}) AS vitals,
      (SELECT sum(requests) FROM analytics_crawlers_hourly WHERE tenant_id = {t:String} AND project_id = {p:String}) AS crawls`,
      query_params: { t: scope.tenantId, p: scope.projectId },
      format: 'JSONEachRow',
    });
    const row = (await result.json<Record<string, number>>())[0];
    expect(Number(row?.views)).toBe(24);
    expect(Number(row?.sessions)).toBe(12);
    expect(Number(row?.vitals)).toBe(12);
    expect(Number(row?.crawls)).toBe(60);
  }, 60_000);
});
