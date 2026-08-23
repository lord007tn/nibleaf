import { describe, expect, it } from 'vitest';
import { getClickHouseClient, insertAnalyticsEvents } from './client';
import { deleteProjectAnalytics, exportProjectAnalytics, rebuildProjectAnalyticsRollups } from './privacy';
import { queryProjectAnalytics, queryWorkspaceAnalytics } from './queries';
import { fixedAnalyticsEvent } from './testing';

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
});
