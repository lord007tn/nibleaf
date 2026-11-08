import { S3ServiceException } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./keys', () => ({
  keys: () => ({
    STORAGE_REGION: 'us-east-1',
    STORAGE_ENDPOINT: 'https://internal.example.test',
    STORAGE_PUBLIC_ENDPOINT: 'https://storage.example.test',
    STORAGE_FORCE_PATH_STYLE: true,
    STORAGE_ACCESS_KEY_ID: 'synthetic',
    STORAGE_SECRET_ACCESS_KEY: 'synthetic-secret',
    STORAGE_BUCKET: 'synthetic-bucket',
  }),
}));
vi.mock('@nibleaf/logger', () => ({ logger: { info: vi.fn(), debug: vi.fn() } }));

import { getS3Client } from './client';
import { objectExists, presignPutUrl } from './index';

describe('upload signing', () => {
  it('signs the exact body length and media type for 600 seconds without an empty-body checksum', async () => {
    const url = new URL(await presignPutUrl({ key: 'projects/a/assets/file.png', contentType: 'image/png', contentLength: 1024 }));
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(expect.arrayContaining(['content-length', 'content-type']));
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect([...url.searchParams.keys()].filter((key) => /checksum/i.test(key))).toEqual([]);
    expect(url.hostname).toBe('storage.example.test');
    expect(await presignPutUrl({ key: 'projects/a/assets/file.png', contentType: 'image/png', contentLength: 1025 })).not.toBe(url.toString());
  });

  it('uses the persisted signing timestamp for the URL lifetime', async () => {
    const signingDate = new Date('2026-11-08T10:00:00Z');
    const url = new URL(await presignPutUrl({ key: 'file.png', contentLength: 1, signingDate }));
    expect(url.searchParams.get('X-Amz-Date')).toBe('20261108T100000Z');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
  });

  it('caps an explicitly requested upload lifetime', async () => {
    const url = new URL(await presignPutUrl({ key: 'file.png', contentLength: 1, expiresInSeconds: 3600 }));
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
  });

  it.each([undefined, 0, 1.5, 50 * 1024 * 1024 + 1])('refuses invalid upload sizes: %s', async (contentLength) => {
    await expect(async () => presignPutUrl({ key: 'file.png', contentLength: contentLength as number })).rejects.toThrow();
  });

  it.each(['NotFound', 'NoSuchKey'])('recognizes missing objects: %s', async (name) => {
    const send = vi
      .spyOn(getS3Client(), 'send')
      .mockRejectedValue(new S3ServiceException({ name, $fault: 'client', $metadata: { httpStatusCode: 404 } }));
    try {
      await expect(objectExists('missing')).resolves.toBe(false);
    } finally {
      send.mockRestore();
    }
  });
});
