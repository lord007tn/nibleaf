import { describe, expect, it, vi } from 'vitest';
import { workersConnected } from './readiness';

const liveWorker = () => ({
  isRunning: () => true,
  key: 'bull:{synthetic}:meta',
  client: Promise.resolve({ status: 'ready', hget: vi.fn(async () => 'PONG') }),
});

describe('owned worker readiness', () => {
  it('requires at least one running, connected worker', async () => {
    expect(await workersConnected([])).toBe(false);
    expect(await workersConnected([liveWorker(), liveWorker()])).toBe(true);
    expect(await workersConnected([{ ...liveWorker(), isRunning: () => false }])).toBe(false);
  });

  it('rejects a reconnecting worker without buffering another read', async () => {
    const hget = vi.fn(async () => 'PONG');
    expect(await workersConnected([{ ...liveWorker(), client: Promise.resolve({ status: 'reconnecting', hget }) }])).toBe(false);
    expect(await workersConnected([{ ...liveWorker(), blockingClient: Promise.resolve({ status: 'reconnecting' }) }])).toBe(false);
    expect(hget).not.toHaveBeenCalled();
  });

  it('bounds initial connection and a silent socket, then recognizes recovery', async () => {
    vi.useFakeTimers();
    try {
      const pendingConnection = workersConnected([{ ...liveWorker(), client: new Promise(() => undefined) }]);
      let releaseRead: (value: string) => void = () => undefined;
      const hget = vi
        .fn<() => Promise<string>>()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseRead = resolve;
            }),
        )
        .mockResolvedValue('PONG');
      const worker = { ...liveWorker(), client: Promise.resolve({ status: 'ready', hget }) };
      const pendingRead = workersConnected([worker]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await pendingConnection).toBe(false);
      expect(await pendingRead).toBe(false);
      for (let attempt = 0; attempt < 5; attempt++) {
        const retry = workersConnected([worker]);
        await vi.advanceTimersByTimeAsync(1000);
        expect(await retry).toBe(false);
      }
      expect(hget).toHaveBeenCalledTimes(1);
      releaseRead('6.2.0');
      await vi.advanceTimersByTimeAsync(0);
      expect(await workersConnected([worker])).toBe(true);
      expect(hget).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed on connection errors and shutdown during the probe', async () => {
    const worker = liveWorker();
    const client = await worker.client;
    client.hget.mockRejectedValueOnce(new Error('synthetic transport failure'));
    expect(await workersConnected([worker])).toBe(false);
    client.hget.mockImplementationOnce(async () => {
      worker.isRunning = () => false;
      return 'PONG';
    });
    expect(await workersConnected([worker])).toBe(false);
  });
});
