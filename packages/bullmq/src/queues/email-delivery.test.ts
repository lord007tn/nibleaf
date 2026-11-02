import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForEmailDelivery } from './email-delivery';

afterEach(() => vi.useRealTimers());

describe('required email provider acknowledgement', () => {
  it('recognizes completion that races the first job snapshot', async () => {
    const getJob = vi
      .fn()
      .mockResolvedValueOnce({ getState: async () => 'completed', returnvalue: null })
      .mockResolvedValue({ getState: async () => 'completed', returnvalue: { sent: true } });
    await expect(waitForEmailDelivery({ getJob }, 'synthetic')).resolves.toBeUndefined();
  });
  it('waits through a queue delay, then requires an explicit accepted result', async () => {
    vi.useFakeTimers();
    const getJob = vi
      .fn()
      .mockResolvedValueOnce({ getState: async () => 'waiting', returnvalue: null })
      .mockResolvedValue({ getState: async () => 'completed', returnvalue: { sent: true } });
    let acknowledged = false;
    const pending = waitForEmailDelivery({ getJob }, 'synthetic').then(() => {
      acknowledged = true;
    });
    await vi.advanceTimersByTimeAsync(149);
    expect(acknowledged).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(acknowledged).toBe(true);
  });

  it.each([undefined, { sent: false }, { sent: 'true' }, {}])('rejects completed but undelivered email (%j)', async (returnvalue) => {
    await expect(waitForEmailDelivery({ getJob: async () => ({ getState: async () => 'completed', returnvalue }) }, 'synthetic')).rejects.toThrow(
      'not accepted',
    );
  });

  it('does not expose a private provider failure or accept a missing job', async () => {
    const queue = { getJob: async () => ({ getState: async () => 'failed', returnvalue: null, failedReason: 'private provider data' }) };
    await expect(waitForEmailDelivery(queue, 'synthetic')).rejects.toThrow('Required email delivery failed.');
    await expect(waitForEmailDelivery({ getJob: async () => undefined }, 'synthetic')).rejects.toThrow('unavailable');
  });

  it('bounds a silently hung queue read as well as an unconsumed job', async () => {
    vi.useFakeTimers();
    const pending = waitForEmailDelivery({ getJob: () => new Promise(() => undefined) }, 'synthetic', 500);
    const result = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(500);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
