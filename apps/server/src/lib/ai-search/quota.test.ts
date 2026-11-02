import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), eval: vi.fn(), disconnect: vi.fn(), clients: vi.fn() }));
vi.mock('@/env', () => ({ env: { REDIS_HOST: 'localhost', REDIS_PORT: 6379, REDIS_DB: 3, SEARCH_ANSWER_DAILY_PER_PROJECT: 2 } }));
vi.mock('ioredis', () => ({
  Redis: class {
    status = 'wait';
    constructor(options: unknown) {
      mocks.clients(options);
    }
    on = vi.fn();
    disconnect = mocks.disconnect;
    eval = mocks.eval;
    async connect() {
      await mocks.connect();
      this.status = 'ready';
    }
  },
}));

describe('answer quota connection lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.eval.mockResolvedValue(1);
  });

  it('waits for one shared first connection before consuming concurrent quotas', async () => {
    let ready: () => void = () => {
      throw new Error('Connection fixture was not initialized');
    };
    mocks.connect.mockReturnValue(
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
    );
    const { consumeAnswerQuota } = await import('./quota');
    const first = consumeAnswerQuota('project-a');
    const second = consumeAnswerQuota('project-a');
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.eval).not.toHaveBeenCalled();
    ready();
    await expect(first).resolves.toEqual({ allowed: true, remaining: 1 });
    await expect(second).resolves.toEqual({ allowed: true, remaining: 1 });
    expect(mocks.eval).toHaveBeenCalledTimes(2);
    mocks.eval.mockResolvedValueOnce(3);
    await expect(consumeAnswerQuota('project-a')).resolves.toEqual({ allowed: false, remaining: 0 });
  });

  it('fails closed on a connection outage and permits a fresh connection on retry', async () => {
    mocks.connect.mockRejectedValueOnce(new Error('quota connection unavailable')).mockResolvedValueOnce(undefined);
    const { consumeAnswerQuota } = await import('./quota');
    await expect(consumeAnswerQuota('project-a')).rejects.toThrow('quota connection unavailable');
    expect(mocks.eval).not.toHaveBeenCalled();
    await expect(consumeAnswerQuota('project-a')).resolves.toEqual({ allowed: true, remaining: 1 });
    expect(mocks.clients).toHaveBeenCalledTimes(2);
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(mocks.clients).toHaveBeenLastCalledWith(
      expect.objectContaining({ enableOfflineQueue: false, connectTimeout: 2000, commandTimeout: 2000 }),
    );
  });
});
