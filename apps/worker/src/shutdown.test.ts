import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/logger', () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));

import { createWorkerShutdown } from './shutdown';

afterEach(() => vi.useRealTimers());
describe('bounded worker shutdown', () => {
  it('marks unready immediately and drains only once under competing signals', async () => {
    let finish: () => void = () => undefined;
    const cleanup = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const unready = vi.fn();
    const exit = vi.fn();
    const shutdown = createWorkerShutdown({ cleanup, unready, exit });
    const pending = shutdown('queue-unavailable', 1);
    expect(unready).toHaveBeenCalledOnce();
    expect(shutdown('SIGTERM')).toBe(pending);
    await Promise.resolve();
    expect(exit).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(cleanup).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('exits nonzero within the deadline when a blocking connection prevents drain', async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const shutdown = createWorkerShutdown({ cleanup: () => new Promise(() => undefined), unready: vi.fn(), exit });
    const pending = shutdown('queue-unavailable', 1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('preserves successful signal shutdown and fails closed on cleanup errors', async () => {
    const exit = vi.fn();
    await createWorkerShutdown({ cleanup: async () => undefined, unready: vi.fn(), exit })('SIGTERM');
    expect(exit).toHaveBeenLastCalledWith(0);
    await createWorkerShutdown({
      cleanup: async () => {
        throw new Error('private detail');
      },
      unready: vi.fn(),
      exit,
    })('SIGTERM');
    expect(exit).toHaveBeenLastCalledWith(1);
  });
});
