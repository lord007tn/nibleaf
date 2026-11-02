import type { QueueWorkerHealth } from '@nibleaf/bullmq/workers';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/bullmq', () => ({ getQueue: vi.fn(), isQueueEnabled: () => true, QueueNames: { EMAIL: 'email' } }));
vi.mock('@nibleaf/bullmq/workers', () => ({ getWorkerHealth: vi.fn() }));
vi.mock('@nibleaf/logger', () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));

import { startWorkerMonitor } from './worker-monitor';

const ready: QueueWorkerHealth[] = [{ queue: 'email', ready: true, reason: 'ready', client: 'ready', blockingClient: 'ready' }];
const broken: QueueWorkerHealth[] = [{ queue: 'email', ready: false, reason: 'blocking-client-not-ready', client: 'ready', blockingClient: 'end' }];
const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});

function monitor(inspect = vi.fn().mockResolvedValue(ready), backlog = vi.fn().mockResolvedValue(0), alert = vi.fn().mockResolvedValue(undefined)) {
  const restart = vi.fn();
  stops.push(startWorkerMonitor({ inspect, backlog, alert, restart }));
  return { inspect, backlog, alert, restart };
}

describe('worker recovery watchdog', () => {
  it('allows transient reconnects and resets the failure window after recovery', async () => {
    vi.useFakeTimers();
    const state = monitor(vi.fn().mockResolvedValue(broken));
    await vi.advanceTimersByTimeAsync(50_000);
    expect(state.restart).not.toHaveBeenCalled();
    state.inspect.mockResolvedValue(ready);
    await vi.advanceTimersByTimeAsync(10_000);
    state.inspect.mockResolvedValue(broken);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(state.restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state.restart).toHaveBeenCalledOnce();
    expect(state.alert).toHaveBeenCalled();
    expect(state.alert.mock.calls[0]?.[0]).toContain('blocking-client-not-ready');
  });

  it('restarts exactly once after 60 seconds of sustained failure', async () => {
    vi.useFakeTimers();
    const state = monitor(vi.fn().mockResolvedValue(broken));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(state.restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(state.restart).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.restart).toHaveBeenCalledOnce();
  });

  it('alerts on old emails without restarting healthy consumers', async () => {
    vi.useFakeTimers();
    const state = monitor(undefined, vi.fn().mockResolvedValue(30_000));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.alert).toHaveBeenCalledOnce();
    expect(state.restart).not.toHaveBeenCalled();
  });

  it('still recovers when alert delivery hangs or rejects', async () => {
    vi.useFakeTimers();
    const state = monitor(
      vi.fn().mockResolvedValue(broken),
      undefined,
      vi.fn(() => new Promise(() => undefined)),
    );
    await vi.advanceTimersByTimeAsync(65_000);
    expect(state.restart).toHaveBeenCalledOnce();
  });

  it('does not overlap probes or restart after shutdown', async () => {
    vi.useFakeTimers();
    let resolve: (value: QueueWorkerHealth[]) => void = () => undefined;
    const inspect = vi.fn(
      () =>
        new Promise<QueueWorkerHealth[]>((done) => {
          resolve = done;
        }),
    );
    const state = monitor(inspect);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(inspect).toHaveBeenCalledOnce();
    stops.at(-1)?.();
    resolve(broken);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(state.restart).not.toHaveBeenCalled();
    expect(state.alert).not.toHaveBeenCalled();
  });

  it('recovers despite a hung backlog read without buffering more reads', async () => {
    vi.useFakeTimers();
    const backlog = vi.fn(() => new Promise<number>(() => undefined));
    const state = monitor(vi.fn().mockResolvedValue(broken), backlog);
    await vi.advanceTimersByTimeAsync(62_000);
    expect(backlog).toHaveBeenCalledOnce();
    expect(state.restart).toHaveBeenCalledOnce();
  });
});
