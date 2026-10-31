import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueueNames } from '../constants';
import { ERASURE_JOB_OPTIONS } from '../jobs/erasure';

const mocks = vi.hoisted(() => ({ close: vi.fn(async () => undefined), queueConstructed: vi.fn(), queueEventsConstructed: vi.fn() }));

vi.mock('bullmq', () => ({
  Queue: class {
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

describe('producer queue lifecycle', () => {
  beforeEach(async () => {
    await closeQueues();
    vi.clearAllMocks();
  });

  it('does not connect to Redis merely because the queue module is imported', () => {
    expect(mocks.queueConstructed).not.toHaveBeenCalled();
    expect(mocks.queueEventsConstructed).not.toHaveBeenCalled();
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
      expect.objectContaining({ defaultJobOptions: expect.objectContaining(ERASURE_JOB_OPTIONS) }),
    );
  });
});
