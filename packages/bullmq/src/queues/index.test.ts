import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueueNames } from '../constants';

const mocks = vi.hoisted(() => ({ close: vi.fn(async () => undefined), queueConstructed: vi.fn(), queueEventsConstructed: vi.fn() }));

vi.mock('bullmq', () => ({
  Queue: class {
    on = vi.fn();
    close = mocks.close;
    drain = vi.fn();
    pause = vi.fn();
    resume = vi.fn();

    constructor(...args: unknown[]) {
      mocks.queueConstructed(...args);
    }
  },
  QueueEvents: class {
    close = vi.fn();

    constructor(...args: unknown[]) {
      mocks.queueEventsConstructed(...args);
    }
  },
}));

import { closeQueues, getQueue, queues } from './index';
import '../index';

const createdOnImport = {
  queues: mocks.queueConstructed.mock.calls.length,
  queueEvents: mocks.queueEventsConstructed.mock.calls.length,
};

describe('producer queue lifecycle', () => {
  beforeEach(async () => {
    await closeQueues();
    vi.clearAllMocks();
  });

  it('does not connect to Redis merely because the queue module is imported', () => {
    expect(createdOnImport).toEqual({ queues: 0, queueEvents: 0 });
  });

  it('creates one producer on first use and closes only owned producers', async () => {
    expect(getQueue(QueueNames.PUBLISH)).toBe(queues[QueueNames.PUBLISH]);
    expect(mocks.queueConstructed).toHaveBeenCalledOnce();

    await closeQueues();
    expect(mocks.close).toHaveBeenCalledOnce();

    getQueue(QueueNames.PUBLISH);
    expect(mocks.queueConstructed).toHaveBeenCalledTimes(2);
  });

  it('gives every erasure job the retry and retention options of its queue', () => {
    getQueue(QueueNames.ERASURE);
    expect(mocks.queueConstructed).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('erasure'),
      expect.objectContaining({
        defaultJobOptions: expect.objectContaining({
          attempts: 16,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnFail: false,
        }),
      }),
    );
  });
});
