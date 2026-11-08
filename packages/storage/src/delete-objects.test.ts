import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('./client', () => ({ getS3Client: () => ({ send: mocks.send }), getBucket: () => 'synthetic-bucket' }));
vi.mock('@nibleaf/logger', () => ({ logger: { info: vi.fn(), debug: vi.fn() } }));

import { deleteObjects, StorageDeleteError } from './index';

it('deletes exact keys in batches of at most 1000 without listing a prefix', async () => {
  const send = mocks.send.mockReset().mockResolvedValue({});
  try {
    const keys = Array.from({ length: 1001 }, (_, index) => `projects/test/assets/${index}.png`);
    await deleteObjects(keys);
    expect(send).toHaveBeenCalledTimes(2);
    const commands = send.mock.calls.map(([command]) => command as DeleteObjectsCommand);
    expect(commands.every((command) => command instanceof DeleteObjectsCommand)).toBe(true);
    expect(commands.map((command) => command.input.Delete?.Objects?.length)).toEqual([1000, 1]);
    expect(commands.flatMap((command) => command.input.Delete?.Objects?.map(({ Key }) => Key) ?? [])).toEqual(keys);
  } finally {
    send.mockReset();
  }
});

it('rejects partial failures so cleanup records can be retained without logging object keys', async () => {
  const send = mocks.send.mockReset().mockResolvedValue({ Errors: [{ Key: 'private-key', Code: 'AccessDenied' }] });
  try {
    await expect(deleteObjects(['private-key'])).rejects.toMatchObject({ failedCount: 1, deletedCount: 0, firstErrorCode: 'AccessDenied' });
    await expect(deleteObjects(['private-key'])).rejects.not.toThrow('private-key');
  } finally {
    send.mockReset();
  }
});

it('reports failed keys privately and keeps processing subsequent chunks', async () => {
  const keys = Array.from({ length: 1001 }, (_, i) => `private-${i}`);
  mocks.send
    .mockReset()
    .mockResolvedValueOnce({ Errors: [{ Key: keys[0], Code: 'AccessDenied' }] })
    .mockResolvedValueOnce({});
  const error = await deleteObjects(keys).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(StorageDeleteError);
  if (!(error instanceof StorageDeleteError)) throw new Error('Expected delete failure');
  expect(error.getFailedKeys()).toEqual([keys[0]]);
  expect(error.deletedCount).toBe(1000);
  expect(JSON.stringify(error)).not.toContain('private-');
  expect(error.message).not.toContain('private-');
  expect(mocks.send).toHaveBeenCalledTimes(2);
});
