import { randomUUID } from 'node:crypto';
import { buildUsageEvent, deterministicUsageEventId, INT64_MAX, utcBillingPeriod } from '@nibleaf/usage';
import { describe, expect, it } from 'vitest';
import { getClickHouseClient, insertAnalyticsEvents } from './client';
import { deleteProjectAnalytics, exportProjectAnalytics, rebuildProjectAnalyticsRollups } from './privacy';
import { queryProjectAnalytics, queryWorkspaceAnalytics } from './queries';
import { fixedAnalyticsEvent } from './testing';
import { deleteProjectUsage, insertUsageEvents, listPendingUsagePeriods, queryUsageMeterTotals, reconcileUsageHourly } from './usage';

const integration = process.env.CLICKHOUSE_INTEGRATION === '1' ? describe : describe.skip;

integration('ClickHouse schema integration', () => {
  it('deduplicates retries in raw facts and rollups', async () => {
    const event = fixedAnalyticsEvent({ occurredAt: new Date().toISOString(), receivedAt: new Date().toISOString() });
    const otherTenantEvent = fixedAnalyticsEvent({
      eventId: '00000000-0000-4000-8000-000000000009',
      occurredAt: event.occurredAt,
      receivedAt: event.receivedAt,
      tenantId: 'tenant-other',
    });
    const unknownCostEvent = fixedAnalyticsEvent({
      eventId: '00000000-0000-4000-8000-000000000010',
      occurredAt: event.occurredAt,
      receivedAt: event.receivedAt,
      payload: { name: 'answer_completed', provider: 'test', model: 'test-model', latencyMs: 25 },
    });
    await insertAnalyticsEvents([event, otherTenantEvent, unknownCostEvent]);
    await insertAnalyticsEvents([event, unknownCostEvent]);
    const client = getClickHouseClient('reader');
    const raw = await client.query({
      query:
        'SELECT count() AS count FROM analytics_events FINAL WHERE tenant_id = {tenant:String} AND project_id = {project:String} AND event_id = {event_id:UUID}',
      query_params: { tenant: event.tenantId, project: event.projectId, event_id: event.eventId },
      format: 'JSONEachRow',
    });
    expect(Number((await raw.json<{ count: number }>())[0]?.count)).toBe(1);
    await rebuildProjectAnalyticsRollups(event.tenantId, event.projectId, client);
    const timezone = 'America/Los_Angeles';
    const dateParts = Object.fromEntries(
      new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date(event.occurredAt))
        .map((part) => [part.type, part.value]),
    );
    const expectedLocalDay = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    const overview = await queryProjectAnalytics(event.tenantId, event.projectId, '7d', timezone, client);
    expect(overview.availability).toBe('partial');
    expect(overview.totalViews).toBe(1);
    expect(overview.timeseries).toContainEqual({ date: expectedLocalDay, views: 1 });
    expect(overview.ai.answersCompleted).toBe(1);
    expect(overview.ai.costMicros).toBeNull();
    const workspace = await queryWorkspaceAnalytics([{ tenantId: event.tenantId, projectId: event.projectId }], '7d', 'UTC', client);
    expect(workspace.availability).toBe('partial');
    expect(workspace.totalViews).toBe(1);
    const exported = await exportProjectAnalytics(event.tenantId, event.projectId, {}, client);
    expect(exported).toHaveLength(2);
    expect(exported.map((item) => item.eventId)).not.toContain(otherTenantEvent.eventId);
    expect(JSON.stringify(exported)).not.toContain('queryHash');
    expect(JSON.stringify(exported)).not.toContain('sessionHash');
    await deleteProjectAnalytics(event.tenantId, event.projectId, client);
    const afterDelete = await client.query({
      query:
        'SELECT tenant_id AS tenant, count() AS count FROM analytics_events FINAL WHERE project_id = {project:String} GROUP BY tenant_id ORDER BY tenant_id',
      query_params: { project: event.projectId },
      format: 'JSONEachRow',
    });
    expect(await afterDelete.json()).toEqual([{ tenant: otherTenantEvent.tenantId, count: 1 }]);
  });

  it('reconciles a closed UTC period with exact coverage and tenant isolation', async () => {
    const now = new Date();
    const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
    const period = utcBillingPeriod(previous.toISOString());
    const projectId = `usage-project-${randomUUID()}`;
    const event = buildUsageEvent(
      {
        eventId: deterministicUsageEventId(`integration:${projectId}:${period.start}`),
        occurredAt: previous.toISOString(),
        meterKey: 'search_query',
        quantity: '1',
        kind: 'usage',
        correctionOfEventId: null,
      },
      { tenantId: 'usage-tenant', projectId, source: 'worker', receivedAt: now },
    );
    await insertUsageEvents([event]);
    await insertUsageEvents([event]);
    expect((await listPendingUsagePeriods()).filter((item) => item.projectId === event.projectId)).toHaveLength(1);
    await reconcileUsageHourly(event.tenantId, event.projectId, period.start, period.endExclusive);
    const totals = await queryUsageMeterTotals(event.tenantId, event.projectId, period.start, period.endExclusive, undefined, {
      now: new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), 1)),
      rawRetentionDays: 7,
    });
    expect(totals).toEqual([expect.objectContaining({ meterKey: 'search_query', quantity: '1', eventCount: '1' })]);
    expect(await queryUsageMeterTotals('usage-other', event.projectId, period.start, period.endExclusive)).toEqual([]);
    await deleteProjectUsage(event.tenantId, event.projectId);
  });

  it('stores exact hourly aggregates wider than a single Int64 fact', async () => {
    const now = new Date();
    const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
    const period = utcBillingPeriod(previous.toISOString());
    const projectId = `usage-wide-${randomUUID()}`;
    const events = ['a', 'b'].map((suffix) =>
      buildUsageEvent(
        {
          eventId: deterministicUsageEventId(`integration:${projectId}:${suffix}`),
          occurredAt: previous.toISOString(),
          meterKey: 'build',
          quantity: INT64_MAX.toString(),
          kind: 'usage',
          correctionOfEventId: null,
        },
        { tenantId: 'usage-tenant', projectId, source: 'worker', receivedAt: now },
      ),
    );
    await insertUsageEvents(events);
    await reconcileUsageHourly('usage-tenant', projectId, period.start, period.endExclusive);
    const client = getClickHouseClient('reader');
    const column = await client.query({
      query: `SELECT type FROM system.columns WHERE database = currentDatabase() AND table = 'usage_hourly' AND name = 'quantity'`,
      format: 'JSONEachRow',
    });
    expect(await column.json()).toEqual([{ type: 'Decimal(38, 0)' }]);
    const totals = await queryUsageMeterTotals('usage-tenant', projectId, period.start, period.endExclusive, client, {
      now: new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), 1)),
      rawRetentionDays: 7,
    });
    expect(totals).toEqual([expect.objectContaining({ meterKey: 'build', quantity: (INT64_MAX * 2n).toString(), eventCount: '2' })]);
    await deleteProjectUsage('usage-tenant', projectId);
  });
});
