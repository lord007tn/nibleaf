import { S3ServiceException } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ provider: 's3' }));
vi.mock('./keys', () => ({
  keys: () => ({
    STORAGE_PROVIDER: env.provider,
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

/** The raw query value as maxio 0.4.2 reads it: split on `;` with no percent-decoding. */
const maxioSignedHeaders = (url: string): string[] => (/[?&]X-Amz-SignedHeaders=([^&]*)/.exec(url)?.[1] ?? '').split(';');

describe('upload signing for maxio (#377)', () => {
  afterEach(() => {
    env.provider = 's3';
  });
  const sign = () =>
    presignPutUrl({
      key: 'projects/a/assets/file.png',
      contentType: 'image/png',
      contentLength: 1024,
      signingDate: new Date('2026-11-08T10:00:00Z'),
    });

  it('writes the signed header list so maxio reads every header, with the same signature', async () => {
    const standard = await sign();
    expect(maxioSignedHeaders(standard)).toEqual(['content-length%3Bcontent-type%3Bhost']);
    env.provider = 'maxio';
    const maxio = await sign();
    expect(maxioSignedHeaders(maxio)).toEqual(['content-length', 'content-type', 'host']);
    // SigV4 canonicalizes `;` and `%3B` alike, so nothing else in the URL changes.
    expect(new URL(maxio).searchParams.get('X-Amz-Signature')).toBe(new URL(standard).searchParams.get('X-Amz-Signature'));
    expect(maxio.replace(/;/g, '%3B')).toBe(standard);
  });

  it('leaves other providers and explicit targets as the SDK signed them', async () => {
    for (const provider of ['s3', 'r2', 'b2', 'minio']) {
      env.provider = provider;
      expect(await sign()).toContain('X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost');
    }
    env.provider = 'maxio';
    const explicit = await presignPutUrl({
      key: 'file.png',
      contentLength: 1,
      target: { endpoint: 'https://other.example.test', region: 'auto', forcePathStyle: true, accessKeyId: 'a', secretAccessKey: 'b', bucket: 'c' },
    });
    expect(explicit).toContain('%3B');
  });
});
