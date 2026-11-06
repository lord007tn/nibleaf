import { fixedAnalyticsEvent } from '@nibleaf/clickhouse/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsEventBatcher } from './event-batcher';

afterEach(() => vi.useRealTimers());
describe('durable analytics microbatches', () => {
  it('joins jobs and acknowledges none before their durable insert finishes', async () => {
    vi.useFakeTimers();
    let release: () => void = () => undefined;
    const durable = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = vi.fn((_events: unknown[]) => durable);
    const batcher = new AnalyticsEventBatcher(write, { maxBatchSize: 500, maxBufferedEvents: 1000, waitMs: 25 });
    let completed = 0;
    const first = batcher.enqueue(fixedAnalyticsEvent()).then(() => {
      completed += 1;
    });
    const second = batcher.enqueue(fixedAnalyticsEvent({ eventId: '00000000-0000-4000-8000-000000000002' })).then(() => {
      completed += 1;
    });
    await vi.advanceTimersByTimeAsync(25);
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[0]).toHaveLength(2);
    expect(completed).toBe(0);
    release();
    await Promise.all([first, second]);
    expect(completed).toBe(2);
  });
  it.each([60_000, 3_600_000, 86_400_000])(
    'rejects pending jobs throughout a simulated %i ms outage and inserts identical facts after recovery',
    async (duration) => {
      vi.useFakeTimers();
      const recoveredAt = Date.now() + duration;
      const write = vi.fn(async (_events: unknown[]) => {
        if (Date.now() < recoveredAt) throw new Error('ECONNREFUSED');
      });
      const batcher = new AnalyticsEventBatcher(write, { maxBatchSize: 10, maxBufferedEvents: 10, waitMs: 25 });
      const event = fixedAnalyticsEvent();
      const first = expect(batcher.enqueue(event)).rejects.toThrow('ECONNREFUSED');
      await vi.advanceTimersByTimeAsync(25);
      await first;
      await vi.advanceTimersByTimeAsync(duration);
      const replay = batcher.enqueue(event);
      await vi.advanceTimersByTimeAsync(25);
      await replay;
      expect(write.mock.calls[0]?.[0]).toEqual(write.mock.calls[1]?.[0]);
    },
  );
  it('rejects excess in-memory admission so its Redis job can retry', async () => {
    vi.useFakeTimers();
    const batcher = new AnalyticsEventBatcher(async () => undefined, { maxBatchSize: 10, maxBufferedEvents: 1, waitMs: 25 });
    const accepted = batcher.enqueue(fixedAnalyticsEvent());
    await expect(batcher.enqueue(fixedAnalyticsEvent())).rejects.toThrow('capacity exceeded');
    await vi.advanceTimersByTimeAsync(25);
    await accepted;
  });
});
