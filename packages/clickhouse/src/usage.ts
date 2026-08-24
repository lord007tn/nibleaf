import type { ClickHouseClient } from '@clickhouse/client';
import {
  aggregateDecimalSchema,
  buildUsageEvent,
  deterministicUsageEventId,
  isLateUsageEvent,
  type MeterKey,
  meterKeySchema,
  type UsageEvent,
  usageEventSchema,
  utcBillingPeriod,
} from '@nibleaf/usage';
import { getClickHouseClient } from './client';
import type { AnalyticsEventEnvelope } from './events';
import { keys } from './keys';

const usageRow = (event: UsageEvent) => ({
  event_id: event.eventId,
  schema_version: event.schemaVersion,
  occurred_at: event.occurredAt,
  received_at: event.receivedAt,
  tenant_id: event.tenantId,
  project_id: event.projectId,
  meter_key: event.meterKey,
  quantity: event.quantity,
  kind: event.kind,
  correction_of_event_id: event.correctionOfEventId,
  source: event.source,
  late: isLateUsageEvent(event) ? 1 : 0,
});

export const insertUsageEvents = async (events: UsageEvent[], client: ClickHouseClient = getClickHouseClient('writer')) => {
  if (events.length === 0) return;
  const parsed = events.map((event) => usageEventSchema.parse(event));
  await client.insert({ table: 'usage_events', format: 'JSONEachRow', values: parsed.map(usageRow) });
  const pending = new Map<
    string,
    { tenant_id: string; project_id: string; period_start: string; period_end: string; source_received_through: string }
  >();
  for (const event of parsed) {
    const period = utcBillingPeriod(event.occurredAt);
    const key = `${event.tenantId}\u0000${event.projectId}\u0000${period.start}`;
    const previous = pending.get(key);
    if (!previous || previous.source_received_through < event.receivedAt) {
      pending.set(key, {
        tenant_id: event.tenantId,
        project_id: event.projectId,
        period_start: period.start,
        period_end: period.endExclusive,
        source_received_through: event.receivedAt,
      });
    }
  }
  const updatedAt = new Date().toISOString();
  await client.insert({
    table: 'usage_reconciliation_state',
    format: 'JSONEachRow',
    values: [...pending.values()].map((state) => ({ ...state, status: 'pending', updated_at: updatedAt })),
  });
};

const fact = (analytics: AnalyticsEventEnvelope, meterKey: MeterKey, quantity: string) =>
  buildUsageEvent(
    {
      eventId: deterministicUsageEventId(`analytics-v${analytics.schemaVersion}:${analytics.eventId}:${meterKey}`),
      occurredAt: analytics.occurredAt,
      meterKey,
      quantity,
      kind: 'usage',
      correctionOfEventId: null,
    },
    { tenantId: analytics.tenantId, projectId: analytics.projectId, source: analytics.source, receivedAt: new Date(analytics.receivedAt) },
  );

/** Deterministic projection from the existing analytics contract. It contains
 * only quantities and server-derived scope; analytics remains the event owner. */
export const usageEventsFromAnalytics = (analytics: AnalyticsEventEnvelope) => {
  const payload = analytics.payload;
  if (payload.name === 'page_view' && analytics.visibility === 'public') return [fact(analytics, 'public_page_view', '1')];
  if (payload.name === 'search_query_submitted') return [fact(analytics, 'search_query', '1')];
  if (payload.name === 'publish_started') return [fact(analytics, 'build', '1')];
  if (payload.name !== 'answer_completed') return [];
  const events = [fact(analytics, 'ai_answer', '1')];
  if (payload.promptTokens !== undefined) events.push(fact(analytics, 'ai_input_token', String(payload.promptTokens)));
  if (payload.completionTokens !== undefined) events.push(fact(analytics, 'ai_output_token', String(payload.completionTokens)));
  return events;
};

export interface UsageMeterTotal {
  meterKey: MeterKey;
  quantity: string;
  eventCount: string;
  lateEventCount: string;
  lastReceivedAt: string;
}

export class UsageHistoryUnavailableError extends Error {
  constructor() {
    super('Usage history is unavailable beyond raw retention until a reconciled rollup exists.');
    this.name = 'UsageHistoryUnavailableError';
  }
}

const monthPeriods = (start: Date, end: Date) => {
  if (
    start.getUTCDate() !== 1 ||
    start.getUTCHours() !== 0 ||
    start.getUTCMinutes() !== 0 ||
    start.getUTCSeconds() !== 0 ||
    start.getUTCMilliseconds() !== 0 ||
    end.getUTCDate() !== 1 ||
    end.getUTCHours() !== 0 ||
    end.getUTCMinutes() !== 0 ||
    end.getUTCSeconds() !== 0 ||
    end.getUTCMilliseconds() !== 0
  )
    return [];
  const periods: Array<{ start: string; endExclusive: string }> = [];
  for (let cursor = start; cursor < end; ) {
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    if (next > end) return [];
    periods.push({ start: cursor.toISOString(), endExclusive: next.toISOString() });
    cursor = next;
  }
  return periods;
};

const assertHistoricalCoverage = async (
  tenantId: string,
  projectId: string,
  periods: Array<{ start: string; endExclusive: string }>,
  client: ClickHouseClient,
) => {
  if (periods.length === 0) throw new UsageHistoryUnavailableError();
  const result = await client.query({
    query: `SELECT formatDateTime(state.period_start, '%FT%T.000Z', 'UTC') AS periodStart,
        formatDateTime(state.period_end, '%FT%T.000Z', 'UTC') AS periodEnd
      FROM (SELECT tenant_id, project_id, period_start, period_end, status, source_received_through
        FROM usage_reconciliation_state FINAL
        WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}) AS state
      INNER JOIN (SELECT tenant_id, project_id, period_start, period_end, fact_received_through, reconciled_at
        FROM usage_reconciliation_coverage FINAL
        WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}) AS coverage
      USING (tenant_id, project_id, period_start, period_end)
      WHERE state.status = 'complete'
        AND state.source_received_through <= coverage.fact_received_through
        AND state.period_start >= parseDateTimeBestEffort({period_start:String})
        AND state.period_end <= parseDateTimeBestEffort({period_end:String})
        AND NOT EXISTS (SELECT 1 FROM usage_deletion_tombstones FINAL
          WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String})`,
    query_params: {
      tenant_id: tenantId,
      project_id: projectId,
      period_start: periods[0]?.start ?? '',
      period_end: periods.at(-1)?.endExclusive ?? '',
    },
    format: 'JSONEachRow',
  });
  const covered = await result.json<{ periodStart: string; periodEnd: string }>();
  const keys = new Set(covered.map((row) => `${new Date(row.periodStart).toISOString()}/${new Date(row.periodEnd).toISOString()}`));
  if (periods.some((period) => !keys.has(`${period.start}/${period.endExclusive}`))) throw new UsageHistoryUnavailableError();
};

export const queryUsageMeterTotals = async (
  tenantId: string,
  projectId: string,
  periodStart: string,
  periodEndExclusive: string,
  client: ClickHouseClient = getClickHouseClient('reader'),
  options: { now?: Date; rawRetentionDays?: number } = {},
) => {
  const rawCutoff = new Date((options.now ?? new Date()).getTime() - (options.rawRetentionDays ?? keys().CLICKHOUSE_RAW_RETENTION_DAYS) * 86_400_000);
  const start = new Date(periodStart);
  const end = new Date(periodEndExclusive);
  if (start < rawCutoff && end > rawCutoff) throw new UsageHistoryUnavailableError();
  if (end <= rawCutoff) {
    await assertHistoricalCoverage(tenantId, projectId, monthPeriods(start, end), client);
    const result = await client.query({
      query: `SELECT meter_key AS meterKey, toString(sum(toDecimal128(quantity, 0))) AS quantity,
        toString(sum(event_count)) AS eventCount, '0' AS lateEventCount,
        toString(max(reconciled_at)) AS lastReceivedAt
      FROM usage_hourly FINAL
      WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}
        AND hour >= parseDateTimeBestEffort({period_start:String}) AND hour < parseDateTimeBestEffort({period_end:String})
        AND NOT EXISTS (SELECT 1 FROM usage_deletion_tombstones FINAL WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String})
      GROUP BY meter_key`,
      query_params: { tenant_id: tenantId, project_id: projectId, period_start: periodStart, period_end: periodEndExclusive },
      format: 'JSONEachRow',
    });
    const rows = await result.json<Record<string, string>>();
    return rows.map((row) => ({
      meterKey: meterKeySchema.parse(row.meterKey),
      quantity: aggregateDecimalSchema.parse(row.quantity),
      eventCount: row.eventCount ?? '0',
      lateEventCount: '0',
      lastReceivedAt: row.lastReceivedAt ?? '',
    }));
  }
  const result = await client.query({
    query: `SELECT
      meter_key AS meterKey,
      toString(sum(toDecimal128(quantity, 0))) AS quantity,
      toString(uniqExact(event_id)) AS eventCount,
      toString(countIf(late = 1)) AS lateEventCount,
      toString(max(received_at)) AS lastReceivedAt
    FROM usage_events FINAL
    WHERE tenant_id = {tenant_id:String}
      AND project_id = {project_id:String}
      AND occurred_at >= parseDateTime64BestEffort({period_start:String})
      AND occurred_at < parseDateTime64BestEffort({period_end:String})
      AND NOT EXISTS (
        SELECT 1 FROM usage_deletion_tombstones FINAL
        WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}
      )
    GROUP BY meter_key`,
    query_params: { tenant_id: tenantId, project_id: projectId, period_start: periodStart, period_end: periodEndExclusive },
    format: 'JSONEachRow',
  });
  const rows = await result.json<Record<string, string>>();
  return rows.map((row) => ({
    meterKey: meterKeySchema.parse(row.meterKey),
    quantity: aggregateDecimalSchema.parse(row.quantity),
    eventCount: row.eventCount ?? '0',
    lateEventCount: row.lateEventCount ?? '0',
    lastReceivedAt: row.lastReceivedAt ?? '',
  }));
};

const assertMonthlyPeriod = (periodStart: string, periodEndExclusive: string) => {
  const periods = monthPeriods(new Date(periodStart), new Date(periodEndExclusive));
  if (
    periods.length !== 1 ||
    periods[0]?.start !== new Date(periodStart).toISOString() ||
    periods[0]?.endExclusive !== new Date(periodEndExclusive).toISOString()
  ) {
    throw new UsageHistoryUnavailableError();
  }
};

export interface PendingUsagePeriod {
  tenantId: string;
  projectId: string;
  periodStart: string;
  periodEndExclusive: string;
}

/** Closed periods whose deduplicated fact count differs from their last proven
 * coverage remain durable work. This catches crashes and late-event races even
 * if a pending state row was superseded while reconciliation was running. */
export const listPendingUsagePeriods = async (client: ClickHouseClient = getClickHouseClient('reader'), limit = 100) => {
  const result = await client.query({
    query: `SELECT state.tenant_id AS tenantId, state.project_id AS projectId,
        formatDateTime(state.period_start, '%FT%T.000Z', 'UTC') AS periodStart,
        formatDateTime(state.period_end, '%FT%T.000Z', 'UTC') AS periodEndExclusive
      FROM (SELECT * FROM usage_reconciliation_state FINAL) AS state
      LEFT JOIN (SELECT * FROM usage_reconciliation_coverage FINAL) AS coverage
        USING (tenant_id, project_id, period_start, period_end)
      LEFT JOIN (
        SELECT tenant_id, project_id, toStartOfMonth(occurred_at) AS period_start,
          addMonths(toStartOfMonth(occurred_at), 1) AS period_end, uniqExact(event_id) AS current_event_count
        FROM usage_events FINAL
        GROUP BY tenant_id, project_id, period_start, period_end
      ) AS facts USING (tenant_id, project_id, period_start, period_end)
      WHERE state.period_end <= toStartOfMonth(now('UTC'))
        AND (state.status = 'pending' OR coverage.event_count IS NULL OR coverage.event_count != facts.current_event_count)
        AND NOT EXISTS (SELECT 1 FROM (SELECT * FROM usage_deletion_tombstones FINAL) AS deleted
          WHERE deleted.tenant_id = state.tenant_id AND deleted.project_id = state.project_id)
      ORDER BY state.updated_at ASC
      LIMIT {limit:UInt16}`,
    query_params: { limit },
    format: 'JSONEachRow',
  });
  const rows = await result.json<Record<string, string>>();
  return rows.map((row) => ({
    tenantId: row.tenantId ?? '',
    projectId: row.projectId ?? '',
    periodStart: new Date(row.periodStart ?? '').toISOString(),
    periodEndExclusive: new Date(row.periodEndExclusive ?? '').toISOString(),
  }));
};

export const reconcileUsageHourly = async (
  tenantId: string,
  projectId: string,
  periodStart: string,
  periodEndExclusive: string,
  client: ClickHouseClient = getClickHouseClient('writer'),
) => {
  assertMonthlyPeriod(periodStart, periodEndExclusive);
  const queryParams = { tenant_id: tenantId, project_id: projectId, period_start: periodStart, period_end: periodEndExclusive };
  await client.command({
    query: `ALTER TABLE usage_hourly DELETE WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}
      AND hour >= parseDateTimeBestEffort({period_start:String}) AND hour < parseDateTimeBestEffort({period_end:String})`,
    query_params: queryParams,
    clickhouse_settings: { mutations_sync: '1' },
  });
  await client.command({
    query: `INSERT INTO usage_hourly
      SELECT toStartOfHour(occurred_at), tenant_id, project_id, meter_key, sum(toDecimal128(quantity, 0)), uniqExact(event_id), now64(3)
      FROM usage_events FINAL
      WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}
        AND occurred_at >= parseDateTime64BestEffort({period_start:String})
        AND occurred_at < parseDateTime64BestEffort({period_end:String})
        AND NOT EXISTS (SELECT 1 FROM usage_deletion_tombstones FINAL WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String})
      GROUP BY toStartOfHour(occurred_at), tenant_id, project_id, meter_key`,
    query_params: queryParams,
  });
  const factsResult = await client.query({
    query: `SELECT toString(uniqExact(event_id)) AS eventCount, toString(max(received_at)) AS receivedThrough
      FROM usage_events FINAL
      WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}
        AND occurred_at >= parseDateTime64BestEffort({period_start:String})
        AND occurred_at < parseDateTime64BestEffort({period_end:String})`,
    query_params: queryParams,
    format: 'JSONEachRow',
  });
  const facts = (await factsResult.json<{ eventCount: string; receivedThrough: string }>())[0];
  const eventCount = facts?.eventCount ?? '0';
  const receivedThrough = facts?.receivedThrough ? new Date(facts.receivedThrough).toISOString() : periodStart;
  const rollupResult = await client.query({
    query: `SELECT toString(sum(event_count)) AS eventCount FROM usage_hourly FINAL
      WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}
        AND hour >= parseDateTimeBestEffort({period_start:String}) AND hour < parseDateTimeBestEffort({period_end:String})`,
    query_params: queryParams,
    format: 'JSONEachRow',
  });
  const rollupCount = (await rollupResult.json<{ eventCount: string }>())[0]?.eventCount ?? '0';
  if (rollupCount !== eventCount) throw new UsageHistoryUnavailableError();
  const reconciledAt = new Date().toISOString();
  await client.insert({
    table: 'usage_reconciliation_coverage',
    format: 'JSONEachRow',
    values: [
      {
        tenant_id: tenantId,
        project_id: projectId,
        period_start: periodStart,
        period_end: periodEndExclusive,
        event_count: eventCount,
        fact_received_through: receivedThrough,
        reconciled_at: reconciledAt,
      },
    ],
  });
  await client.insert({
    table: 'usage_reconciliation_state',
    format: 'JSONEachRow',
    values: [
      {
        tenant_id: tenantId,
        project_id: projectId,
        period_start: periodStart,
        period_end: periodEndExclusive,
        status: 'complete',
        source_received_through: receivedThrough,
        updated_at: reconciledAt,
      },
    ],
  });
};

/** Tombstone first, then synchronously delete facts and projections. Queries
 * exclude tombstoned projects so retries/backfills cannot resurrect usage. */
export const deleteProjectUsage = async (tenantId: string, projectId: string, client: ClickHouseClient = getClickHouseClient('writer')) => {
  await client.insert({
    table: 'usage_deletion_tombstones',
    format: 'JSONEachRow',
    values: [{ tenant_id: tenantId, project_id: projectId, deleted_at: new Date().toISOString(), reason: 'privacy_deletion' }],
  });
  for (const table of ['usage_events', 'usage_hourly', 'usage_reconciliation_state', 'usage_reconciliation_coverage']) {
    await client.command({
      query: `ALTER TABLE ${table} DELETE WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}`,
      query_params: { tenant_id: tenantId, project_id: projectId },
      clickhouse_settings: { mutations_sync: '1' },
    });
  }
};
