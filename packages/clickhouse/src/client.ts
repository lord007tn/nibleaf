import { type ClickHouseClient, createClient } from '@clickhouse/client';
import { createLogger } from '@nibleaf/logger';
import type { AnalyticsEventEnvelope, AnalyticsPayload } from './events';
import { type ClickHouseKeys, keys } from './keys';
import { redactAnalyticsDiagnostics } from './redaction';

const log = createLogger({ package: 'clickhouse' });
export type ClickHouseClientRole = 'reader' | 'writer';

const clients = new Map<ClickHouseClientRole, ClickHouseClient>();

export const getClickHouseClient = (role: ClickHouseClientRole = 'reader', config: ClickHouseKeys = keys()): ClickHouseClient => {
  const cached = clients.get(role);
  if (cached) return cached;
  const username = role === 'writer' ? config.CLICKHOUSE_WRITER_USERNAME : config.CLICKHOUSE_READER_USERNAME;
  const password = role === 'writer' ? config.CLICKHOUSE_WRITER_PASSWORD : config.CLICKHOUSE_READER_PASSWORD;
  const client = createClient({
    url: config.CLICKHOUSE_URL,
    database: config.CLICKHOUSE_DATABASE,
    username,
    password,
    request_timeout: config.CLICKHOUSE_REQUEST_TIMEOUT_MS,
    application: `nibleaf-analytics-${role}`,
    clickhouse_settings: {
      date_time_input_format: 'best_effort',
      async_insert: role === 'writer' ? 1 : 0,
      wait_for_async_insert: role === 'writer' ? 1 : 0,
    },
  });
  clients.set(role, client);
  return client;
};

export const closeClickHouseClients = async (): Promise<void> => {
  const closing = [...clients.values()].map((client) => client.close());
  clients.clear();
  await Promise.allSettled(closing);
};

const payloadValue = (payload: AnalyticsPayload, key: string): unknown => (payload as unknown as Record<string, unknown>)[key];
const asNumber = (value: unknown): number => (typeof value === 'number' ? value : 0);
const hasNumber = (value: unknown): number => (typeof value === 'number' ? 1 : 0);
const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

export const eventToClickHouseRow = (event: AnalyticsEventEnvelope) => {
  const payload = event.payload;
  return {
    event_id: event.eventId,
    schema_version: event.schemaVersion,
    occurred_at: event.occurredAt,
    received_at: event.receivedAt,
    tenant_id: event.tenantId,
    project_id: event.projectId,
    site_id: event.siteId,
    deployment_id: event.deploymentId,
    source: event.source,
    consent_state: event.consentState,
    visibility: event.visibility,
    event_name: payload.name,
    session_hash: event.sessionHash,
    anonymous_user_hash: event.anonymousUserHash,
    path: asString(payloadValue(payload, 'path')),
    target_path: asString(payloadValue(payload, 'targetPath')),
    placement: asString(payloadValue(payload, 'placement')),
    referrer_domain: asString(payloadValue(payload, 'referrer')),
    language: asString(payloadValue(payload, 'language')),
    country: event.country ?? '',
    device: event.device ?? '',
    utm_source: asString(payloadValue(payload, 'utmSource')),
    utm_medium: asString(payloadValue(payload, 'utmMedium')),
    utm_campaign: asString(payloadValue(payload, 'utmCampaign')),
    utm_content: asString(payloadValue(payload, 'utmContent')),
    utm_term: asString(payloadValue(payload, 'utmTerm')),
    operation_id: asString(payloadValue(payload, 'operationId')),
    source_type: asString(payloadValue(payload, 'sourceType')),
    format: asString(payloadValue(payload, 'format')),
    outcome_reason: asString(payloadValue(payload, 'outcomeReason')),
    item_count: asNumber(payloadValue(payload, 'itemCount')),
    result_count: asNumber(payloadValue(payload, 'resultCount')),
    result_position: asNumber(payloadValue(payload, 'resultPosition')),
    result_id: asString(payloadValue(payload, 'resultId')),
    feedback: asString(payloadValue(payload, 'feedback')),
    feedback_target: asString(payloadValue(payload, 'target')),
    provider: asString(payloadValue(payload, 'provider')),
    model: asString(payloadValue(payload, 'model')),
    cache_status: asString(payloadValue(payload, 'cacheStatus')),
    no_answer_reason: asString(payloadValue(payload, 'noAnswerReason')),
    citation_id: asString(payloadValue(payload, 'citationId')),
    citation_position: asNumber(payloadValue(payload, 'citationPosition')),
    duration_ms: asNumber(payloadValue(payload, 'durationMs')),
    engagement_ms: asNumber(payloadValue(payload, 'engagementMs')),
    scroll_depth: asNumber(payloadValue(payload, 'scrollDepth')),
    latency_ms: asNumber(payloadValue(payload, 'latencyMs')),
    latency_known: hasNumber(payloadValue(payload, 'latencyMs')),
    prompt_tokens: asNumber(payloadValue(payload, 'promptTokens')),
    completion_tokens: asNumber(payloadValue(payload, 'completionTokens')),
    cost_micros: asNumber(payloadValue(payload, 'costMicros')),
    prompt_tokens_known: hasNumber(payloadValue(payload, 'promptTokens')),
    completion_tokens_known: hasNumber(payloadValue(payload, 'completionTokens')),
    cost_micros_known: hasNumber(payloadValue(payload, 'costMicros')),
    query_hash: event.queryHash,
    query_length: event.queryLength ?? 0,
    query_token_count: event.queryTokenCount ?? 0,
  };
};

const retryable = (error: unknown): boolean => {
  const status = Number((error as { status?: number })?.status ?? 0);
  return status === 0 || status === 408 || status === 429 || status >= 500;
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const excludeTombstonedAnalytics = async (events: AnalyticsEventEnvelope[], client: ClickHouseClient) => {
  const scopes = [...new Map(events.map((event) => [JSON.stringify([event.tenantId, event.projectId]), event])).values()];
  const result = await client.query({
    query: `SELECT tenant_id AS tenantId, project_id AS projectId
      FROM analytics_deletion_tombstones FINAL
      WHERE (tenant_id, project_id) IN arrayZip({tenant_ids:Array(String)}, {project_ids:Array(String)})`,
    query_params: {
      tenant_ids: scopes.map((event) => event.tenantId),
      project_ids: scopes.map((event) => event.projectId),
    },
    format: 'JSONEachRow',
  });
  const tombstoned = new Set(
    (await result.json<{ tenantId: string; projectId: string }>()).map((row) => JSON.stringify([row.tenantId, row.projectId])),
  );
  return events.filter((event) => !tombstoned.has(JSON.stringify([event.tenantId, event.projectId])));
};

/** Low-level ClickHouse transport. Production runtime callers must hold the
 * Postgres tenant analytics write fence; the tombstone query is only a
 * defense-in-depth filter. */
export const insertAnalyticsEvents = async (
  events: AnalyticsEventEnvelope[],
  options: { client?: ClickHouseClient; attempts?: number } = {},
): Promise<void> => {
  if (events.length === 0) return;
  const client = options.client ?? getClickHouseClient('writer');
  const attempts = options.attempts ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const accepted = await excludeTombstonedAnalytics(events, client);
      if (accepted.length === 0) return;
      await client.insert({ table: 'analytics_events', format: 'JSONEachRow', values: accepted.map(eventToClickHouseRow) });
      const sensitive = accepted
        .filter((event): event is AnalyticsEventEnvelope & { sensitiveQueryText: string } => Boolean(event.sensitiveQueryText))
        .map((event) => ({
          event_id: event.eventId,
          tenant_id: event.tenantId,
          project_id: event.projectId,
          occurred_at: event.occurredAt,
          query_text: event.sensitiveQueryText,
        }));
      if (sensitive.length > 0) {
        await client.insert({ table: 'analytics_sensitive_queries', format: 'JSONEachRow', values: sensitive });
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !retryable(error)) break;
      await delay(50 * 2 ** (attempt - 1) + Math.floor(Math.random() * 50));
    }
  }
  log.warn({ error: redactAnalyticsDiagnostics(lastError), eventCount: events.length }, 'ClickHouse analytics insert failed');
  throw lastError;
};

export interface AnalyticsHealth {
  configured: boolean;
  latencyMs: number | null;
  status: 'disabled' | 'ok' | 'unavailable';
}

export const clickHouseHealth = async (): Promise<AnalyticsHealth> => {
  const config = keys();
  if (config.ANALYTICS_MODE === 'disabled') return { configured: false, latencyMs: null, status: 'disabled' };
  const started = performance.now();
  try {
    const result = await getClickHouseClient('reader').query({ query: 'SELECT 1 AS ok', format: 'JSONEachRow' });
    await result.json();
    return { configured: true, latencyMs: Math.round(performance.now() - started), status: 'ok' };
  } catch {
    return { configured: true, latencyMs: null, status: 'unavailable' };
  }
};

export class AnalyticsBatchWriter {
  readonly #client: ClickHouseClient;
  readonly #maxBatchSize: number;
  readonly #maxBufferedEvents: number;
  readonly #flushIntervalMs: number;
  readonly #queue: AnalyticsEventEnvelope[] = [];
  #timer: NodeJS.Timeout | null = null;
  #flushPromise: Promise<void> | null = null;
  #inFlight = 0;

  constructor(options: { client?: ClickHouseClient; maxBatchSize?: number; maxBufferedEvents?: number; flushIntervalMs?: number } = {}) {
    const config = keys();
    this.#client = options.client ?? getClickHouseClient('writer');
    this.#maxBatchSize = options.maxBatchSize ?? config.CLICKHOUSE_MAX_BATCH_SIZE;
    this.#maxBufferedEvents = options.maxBufferedEvents ?? config.CLICKHOUSE_MAX_BUFFERED_EVENTS;
    this.#flushIntervalMs = options.flushIntervalMs ?? config.CLICKHOUSE_FLUSH_INTERVAL_MS;
  }

  get buffered(): number {
    return this.#queue.length + this.#inFlight;
  }

  enqueue(event: AnalyticsEventEnvelope): boolean {
    if (this.buffered >= this.#maxBufferedEvents) return false;
    this.#queue.push(event);
    if (this.#queue.length >= this.#maxBatchSize) this.#flushSafely();
    else this.#schedule();
    return true;
  }

  #flushSafely(): void {
    void this.flush().catch((error) => {
      log.warn({ error: redactAnalyticsDiagnostics(error), buffered: this.buffered }, 'ClickHouse analytics batch retained for retry');
    });
  }

  #schedule(): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#flushSafely();
    }, this.#flushIntervalMs);
    this.#timer.unref?.();
  }

  async flush(): Promise<void> {
    if (this.#flushPromise) return this.#flushPromise;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const batch = this.#queue.splice(0, this.#maxBatchSize);
    if (batch.length === 0) return;
    this.#inFlight = batch.length;
    this.#flushPromise = insertAnalyticsEvents(batch, { client: this.#client })
      .catch((error) => {
        this.#queue.unshift(...batch);
        throw error;
      })
      .finally(() => {
        this.#inFlight = 0;
        this.#flushPromise = null;
        if (this.#queue.length > 0) this.#schedule();
      });
    return this.#flushPromise;
  }

  async close(): Promise<void> {
    while (this.#queue.length > 0 || this.#flushPromise) await this.flush();
  }
}
