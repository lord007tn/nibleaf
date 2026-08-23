import type { ClickHouseClient } from '@clickhouse/client';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsBatchWriter, eventToClickHouseRow, insertAnalyticsEvents } from './client';
import { fixedAnalyticsEvent } from './testing';

describe('ClickHouse ingestion', () => {
  it('maps only flattened bounded columns into the raw fact row', () => {
    const row = eventToClickHouseRow(fixedAnalyticsEvent());
    expect(row).toMatchObject({ event_name: 'page_view', project_id: 'project-1', path: 'docs/start', device: 'desktop' });
    expect(row).not.toHaveProperty('sensitiveQueryText');
    expect(row).not.toHaveProperty('payload');
  });

  it('retries retryable inserts and preserves one stable event id', async () => {
    const insert = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 503 }))
      .mockResolvedValue(undefined);
    await insertAnalyticsEvents([fixedAnalyticsEvent()], { client: { insert } as unknown as ClickHouseClient, attempts: 2 });
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[0]?.[0].values[0].event_id).toBe(insert.mock.calls[1]?.[0].values[0].event_id);
  });

  it('applies bounded backpressure before accepting more buffered events', () => {
    const writer = new AnalyticsBatchWriter({
      client: { insert: vi.fn().mockResolvedValue(undefined) } as unknown as ClickHouseClient,
      maxBatchSize: 100,
      maxBufferedEvents: 2,
      flushIntervalMs: 30_000,
    });
    expect(writer.enqueue(fixedAnalyticsEvent())).toBe(true);
    expect(writer.enqueue(fixedAnalyticsEvent({ eventId: '00000000-0000-4000-8000-000000000002' }))).toBe(true);
    expect(writer.enqueue(fixedAnalyticsEvent({ eventId: '00000000-0000-4000-8000-000000000003' }))).toBe(false);
  });

  it('retains a failed batch for a later retry without reopening capacity', async () => {
    const insert = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('invalid'), { status: 400 }))
      .mockResolvedValue(undefined);
    const writer = new AnalyticsBatchWriter({
      client: { insert } as unknown as ClickHouseClient,
      maxBatchSize: 100,
      maxBufferedEvents: 1,
      flushIntervalMs: 30_000,
    });
    expect(writer.enqueue(fixedAnalyticsEvent())).toBe(true);
    await expect(writer.flush()).rejects.toThrow('invalid');
    expect(writer.buffered).toBe(1);
    expect(writer.enqueue(fixedAnalyticsEvent({ eventId: '00000000-0000-4000-8000-000000000002' }))).toBe(false);
    await writer.flush();
    expect(writer.buffered).toBe(0);
  });
});
