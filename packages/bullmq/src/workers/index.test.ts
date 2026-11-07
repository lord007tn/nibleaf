import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueueNames } from '../constants';

const mocks = vi.hoisted(() => ({
  constructed: vi.fn(),
  // Accessing any producer queue on restart is forbidden, including queues
  // outside the worker allowlist. No Redis or jobs are touched by this fixture.
  queues: new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error('Worker startup inspected producer queues');
      },
    },
  ),
}));
vi.mock('../queues/index', () => ({ queues: mocks.queues, closeQueueEvents: vi.fn(), closeQueues: vi.fn() }));
vi.mock('bullmq', () => ({
  Worker: class {
    constructor(...args: unknown[]) {
      mocks.constructed(...args);
    }
    on = vi.fn();
    close = vi.fn();
    getBackend = () => ({});
  },
}));

import { bootWorkers, closeWorkers } from './index';

afterEach(async () => {
  await closeWorkers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('development worker restart', () => {
  it('restarts only enabled consumers without inspecting or deleting queued jobs', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('WORKER_QUEUES', QueueNames.EMAIL);
    const email = vi.fn();
    const publish = vi.fn();
    for (let restart = 0; restart < 2; restart++) {
      const workers = await bootWorkers({ [QueueNames.EMAIL]: email, [QueueNames.PUBLISH]: publish });
      expect(workers).toHaveLength(1);
      expect(mocks.constructed).toHaveBeenLastCalledWith(expect.stringContaining('email'), email, expect.any(Object));
      await closeWorkers();
    }
    expect(mocks.constructed).toHaveBeenCalledTimes(2);
    expect(email).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
