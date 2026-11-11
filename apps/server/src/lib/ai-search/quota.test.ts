import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), eval: vi.fn(), get: vi.fn(), disconnect: vi.fn(), clients: vi.fn() }));
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
    get = mocks.get;
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

describe("reading today's answers", () => {
  const now = new Date('2026-11-11T22:30:00.000Z');
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue(undefined);
  });

  it('reads the UTC-day count of completed answers without spending one', async () => {
    mocks.get.mockResolvedValue('1');
    const { readAnswerQuota } = await import('./quota');
    await expect(readAnswerQuota('project-a', now)).resolves.toEqual({ answersToday: 1, limit: 2, resetsAt: '2026-11-12T00:00:00.000Z' });
    // The completed-answers counter, not the spend counter, which also counts failed generations.
    expect(mocks.get).toHaveBeenCalledWith('{search-answer-served}:project-a:2026-11-11');
    expect(mocks.eval).not.toHaveBeenCalled();
  });

  it('counts a day with no answers as zero', async () => {
    const { readAnswerQuota } = await import('./quota');
    mocks.get.mockResolvedValueOnce(null);
    expect((await readAnswerQuota('project-a', now)).answersToday).toBe(0);
  });

  it('counts an answer only once it completed: a failed generation spends quota but is not counted', async () => {
    const { consumeAnswerQuota, recordAnswerServed } = await import('./quota');
    await consumeAnswerQuota('project-a', now);
    expect(mocks.eval).toHaveBeenLastCalledWith(expect.any(String), 1, '{search-answer-quota}:project-a:2026-11-11');
    // Generation failed: nothing recorded. Then one succeeds:
    await recordAnswerServed('project-a', now);
    expect(mocks.eval).toHaveBeenLastCalledWith(expect.stringContaining('INCR'), 1, '{search-answer-served}:project-a:2026-11-11');
    expect(mocks.eval).toHaveBeenCalledTimes(2);
  });

  it('never fails an answer when the completed count cannot be recorded', async () => {
    mocks.connect.mockRejectedValue(new Error('down'));
    const { recordAnswerServed } = await import('./quota');
    await expect(recordAnswerServed('project-a', now)).resolves.toBeUndefined();
  });

  it('reports an unknown count instead of failing when the counter cannot be read', async () => {
    mocks.connect.mockRejectedValue(new Error('down'));
    const { readAnswerQuota } = await import('./quota');
    await expect(readAnswerQuota('project-a', now)).resolves.toMatchObject({ answersToday: null, limit: 2 });
  });
});
