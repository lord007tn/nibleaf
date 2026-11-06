import type { AnalyticsEventEnvelope } from '@nibleaf/clickhouse';

interface PendingEvent {
  event: AnalyticsEventEnvelope;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/** Redis owns durability. This buffer only joins already-active jobs while
 * their tenant write fences remain held. Each promise resolves after both raw
 * and sensitive rows are durable; rejection returns every job to BullMQ. */
export class AnalyticsEventBatcher {
  readonly #pending: PendingEvent[] = [];
  #timer: NodeJS.Timeout | undefined;
  #flushing = false;
  constructor(
    readonly write: (events: AnalyticsEventEnvelope[]) => Promise<void>,
    readonly options: { maxBatchSize: number; maxBufferedEvents: number; waitMs: number },
  ) {}

  enqueue(event: AnalyticsEventEnvelope): Promise<void> {
    if (this.#pending.length >= this.options.maxBufferedEvents) return Promise.reject(new Error('Analytics batch capacity exceeded; retry job'));
    return new Promise((resolve, reject) => {
      this.#pending.push({ event, resolve, reject });
      if (this.#pending.length >= this.options.maxBatchSize) void this.flush();
      else this.#schedule();
    });
  }

  #schedule() {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.flush();
    }, this.options.waitMs);
    this.#timer.unref();
  }

  async flush(): Promise<void> {
    if (this.#flushing) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    const batch = this.#pending.splice(0, this.options.maxBatchSize);
    if (!batch.length) return;
    this.#flushing = true;
    try {
      await this.write(batch.map((entry) => entry.event));
      for (const entry of batch) entry.resolve();
    } catch (error) {
      for (const entry of batch) entry.reject(error);
    } finally {
      this.#flushing = false;
      if (this.#pending.length) this.#schedule();
    }
  }
}
