import { S3ServiceException } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('./client', () => ({ getS3Client: () => ({ send: mocks.send }), getBucket: () => 'synthetic-bucket' }));
vi.mock('@nibleaf/logger', () => ({ logger: { info: vi.fn() } }));

import { ensureBucket } from './index';

const missingBucket = () => new S3ServiceException({ name: 'NotFound', $fault: 'client', $metadata: { httpStatusCode: 404 } });

describe('bucket bootstrap failure propagation', () => {
  it('accepts an accessible existing bucket without trying to create it', async () => {
    mocks.send.mockReset().mockResolvedValue({});
    await ensureBucket();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('creates a missing bucket', async () => {
    mocks.send.mockReset().mockRejectedValueOnce(missingBucket()).mockResolvedValue({});
    await ensureBucket();
    expect(mocks.send.mock.calls.map(([command]) => command.constructor.name)).toEqual(['HeadBucketCommand', 'CreateBucketCommand']);
  });
  it('confirms bucket access after a concurrent creation', async () => {
    mocks.send.mockReset().mockRejectedValueOnce(missingBucket()).mockRejectedValueOnce(new Error('already exists')).mockResolvedValue({});
    await ensureBucket();
    expect(mocks.send).toHaveBeenCalledTimes(3);
  });
  it('preserves the original create error when the follow-up bucket check also fails', async () => {
    const createError = new Error('bucket creation failed');
    mocks.send
      .mockReset()
      .mockRejectedValueOnce(missingBucket())
      .mockRejectedValueOnce(createError)
      .mockRejectedValueOnce(new Error('follow-up bucket check failed'));
    await expect(ensureBucket()).rejects.toBe(createError);
    expect(mocks.send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      'HeadBucketCommand',
      'CreateBucketCommand',
      'HeadBucketCommand',
    ]);
  });
  it('rejects unavailable or inaccessible storage instead of reporting success', async () => {
    const failure = new Error('storage unavailable');
    mocks.send.mockReset().mockRejectedValue(failure);
    await expect(ensureBucket()).rejects.toBe(failure);
  });
  it.each([403, 503])('does not try to create a bucket after a failed HeadBucket (%s)', async (status) => {
    const failure = new S3ServiceException({
      name: status === 403 ? 'AccessDenied' : 'ServiceUnavailable',
      $fault: 'client',
      $metadata: { httpStatusCode: status },
    });
    mocks.send.mockReset().mockRejectedValue(failure);
    await expect(ensureBucket()).rejects.toBe(failure);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0]?.[0].constructor.name).toBe('HeadBucketCommand');
  });
});
