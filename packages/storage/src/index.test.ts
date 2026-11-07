import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('./client', () => ({ getS3Client: () => ({ send: mocks.send }), getBucket: () => 'synthetic-bucket' }));
vi.mock('@nibleaf/logger', () => ({ logger: { info: vi.fn() } }));

import { ensureBucket } from './index';

describe('bucket bootstrap failure propagation', () => {
  it('accepts an accessible existing bucket without trying to create it', async () => {
    mocks.send.mockReset().mockResolvedValue({});
    await ensureBucket();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('creates a missing bucket', async () => {
    mocks.send.mockReset().mockRejectedValueOnce(new Error('missing')).mockResolvedValue({});
    await ensureBucket();
    expect(mocks.send.mock.calls.map(([command]) => command.constructor.name)).toEqual(['HeadBucketCommand', 'CreateBucketCommand']);
  });
  it('confirms bucket access after a concurrent creation', async () => {
    mocks.send.mockReset().mockRejectedValueOnce(new Error('missing')).mockRejectedValueOnce(new Error('already exists')).mockResolvedValue({});
    await ensureBucket();
    expect(mocks.send).toHaveBeenCalledTimes(3);
  });
  it('rejects unavailable or inaccessible storage instead of reporting success', async () => {
    const failure = new Error('storage unavailable');
    mocks.send.mockReset().mockRejectedValue(failure);
    await expect(ensureBucket()).rejects.toBe(failure);
  });
});
