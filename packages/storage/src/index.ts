import { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  ListObjectsV2Command,
  type ObjectIdentifier,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '@nibleaf/logger';
import { getBucket, getPublicBaseUrl, getS3Client, publicTarget, type StorageTarget } from './client';
import { keys } from './keys';

export { defaultTarget, getBucket, getPublicBaseUrl, getS3Client, publicTarget, type StorageTarget } from './client';

const DELETE_BATCH_SIZE = 1000;
/** Largest body a presigned upload may declare. Kept equal to MAX_ASSET_UPLOAD_BYTES
 *  in @nibleaf/shared/constants; a server test pins the two together. */
export const MAX_PRESIGNED_UPLOAD_BYTES = 50 * 1024 * 1024;
export const DEFAULT_PRESIGN_EXPIRES_IN_SECONDS = 3600;
export const UPLOAD_PRESIGN_EXPIRES_IN_SECONDS = 600;

/** S3 error codes are short identifiers. Anything else a backend sends stays out of logs. */
const safeErrorCode = (code: string | undefined): string => (code && /^\w{1,64}$/.test(code) ? code : 'unknown');

export class StorageDeleteError extends Error {
  readonly #failedKeys: readonly string[];
  constructor(
    readonly failedCount: number,
    readonly deletedCount: number,
    readonly firstErrorCode: string,
    failedKeys: readonly string[] = [],
  ) {
    super(`Could not delete ${failedCount} stored object(s); first error code: ${firstErrorCode}.`);
    this.name = 'StorageDeleteError';
    this.#failedKeys = [...failedKeys];
  }

  /** Internal retry routing only. Keys are intentionally non-enumerable and never part of the error message. */
  getFailedKeys(): readonly string[] {
    return this.#failedKeys;
  }
}

/** Create the bucket if it does not exist yet (idempotent; used on API boot for self-host). */
export const ensureBucket = async (target?: StorageTarget): Promise<void> => {
  const client = getS3Client(target);
  const bucket = getBucket(target);
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    // Missing bucket is the only reason to create one. Permission and transport
    // failures must not cause CreateBucket audit alerts on managed storage.
    if (!isNotFound(error)) throw error;
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      logger.info({ bucket }, 'created storage bucket');
    } catch (error) {
      // Another API may have created it concurrently. Confirm access before
      // treating a failed create as success; bootstrap readiness relies on this.
      await client.send(new HeadBucketCommand({ Bucket: bucket })).catch(() => {
        throw error;
      });
    }
  }
};

export const putObject = async (key: string, body: Buffer | Uint8Array | string, contentType?: string, target?: StorageTarget): Promise<void> => {
  await getS3Client(target).send(new PutObjectCommand({ Bucket: getBucket(target), Key: key, Body: body, ContentType: contentType }));
};

/** Bounded, backpressured PUT via the internal endpoint. Never buffer an upload
 * or retry a consumed stream. The caller owns durable failure cleanup. */
export const putObjectStream = async (
  key: string,
  body: ReadableStream<Uint8Array>,
  contentLength: number,
  contentType: string,
  signal?: AbortSignal,
): Promise<void> => {
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > MAX_PRESIGNED_UPLOAD_BYTES) {
    throw new Error('Upload size must be between 1 byte and 50 MiB.');
  }
  const controller = new AbortController();
  const abortSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]);
  const reader = body.getReader();
  let complete = false;
  const stream = Readable.from(
    (async function* () {
      let received = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        received += chunk.value.byteLength;
        if (received > contentLength || received > MAX_PRESIGNED_UPLOAD_BYTES) {
          controller.abort();
          throw new Error('Upload exceeds reserved size.');
        }
        yield chunk.value;
      }
      if (received !== contentLength) throw new Error('Upload does not match reserved size.');
      complete = true;
    })(),
    { objectMode: false },
  );
  // Cancel a blocked inbound read on disconnect, timeout or a size violation.
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  abortSignal.addEventListener('abort', cancel, { once: true });
  stream.on('error', () => controller.abort());
  try {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: key,
        Body: stream,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      { abortSignal },
    );
    if (!complete) throw new Error('Storage completed before the upload body was validated.');
  } finally {
    abortSignal.removeEventListener('abort', cancel);
    stream.destroy();
    await reader.cancel().catch(() => undefined);
  }
};

export const getObjectStream = async (key: string, target?: StorageTarget, abortSignal?: AbortSignal): Promise<Readable> => {
  const result = await getS3Client(target).send(new GetObjectCommand({ Bucket: getBucket(target), Key: key }), { abortSignal });
  const body = result.Body;
  if (!(body instanceof Readable)) {
    throw new Error(`Object body for "${key}" is not a readable stream`);
  }
  return body;
};

export const headObject = (key: string, target?: StorageTarget): Promise<HeadObjectCommandOutput> =>
  getS3Client(target).send(new HeadObjectCommand({ Bucket: getBucket(target), Key: key }));

export const objectExists = async (key: string, target?: StorageTarget): Promise<boolean> => {
  try {
    await headObject(key, target);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
};

export const deleteObject = async (key: string, target?: StorageTarget): Promise<void> => {
  await getS3Client(target).send(new DeleteObjectCommand({ Bucket: getBucket(target), Key: key }));
};

/** Delete exact keys in S3-compatible batches, retaining only failed keys for retry routing. */
export const deleteObjects = async (keys: string[], target?: StorageTarget): Promise<void> => {
  const client = getS3Client(target);
  const failed: string[] = [];
  let firstErrorCode: string | undefined;
  for (let offset = 0; offset < keys.length; offset += DELETE_BATCH_SIZE) {
    const batch = keys.slice(offset, offset + DELETE_BATCH_SIZE);
    try {
      const { Errors: errors = [] } = await client.send(
        new DeleteObjectsCommand({
          Bucket: getBucket(target),
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      const failures = errors.filter((error) => error.Code !== 'NoSuchKey' && error.Code !== 'NotFound');
      if (failures.some((error) => !error.Key || !batch.includes(error.Key))) {
        failed.push(...batch);
      } else {
        failed.push(...failures.flatMap((error) => (error.Key ? [error.Key] : [])));
      }
      firstErrorCode ??= failures[0]?.Code;
    } catch {
      failed.push(...batch);
      firstErrorCode ??= 'StorageUnavailable';
    }
  }
  const failedKeys = [...new Set(failed)];
  if (failedKeys.length) throw new StorageDeleteError(failedKeys.length, keys.length - failedKeys.length, safeErrorCode(firstErrorCode), failedKeys);
};

export const deletePrefix = async (prefix: string, target?: StorageTarget): Promise<number> => {
  const client = getS3Client(target);
  const bucket = getBucket(target);
  let continuationToken: string | undefined;
  let deleted = 0;
  let failed = 0;
  let firstErrorCode: string | undefined;
  do {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }));
    const identifiers: ObjectIdentifier[] = (listed.Contents ?? []).flatMap((object) => (object.Key ? [{ Key: object.Key }] : []));
    for (let i = 0; i < identifiers.length; i += DELETE_BATCH_SIZE) {
      const batch = identifiers.slice(i, i + DELETE_BATCH_SIZE);
      const { Errors: errors = [] } = await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch, Quiet: true } }));
      deleted += batch.length - errors.length;
      failed += errors.length;
      firstErrorCode ??= errors[0]?.Code;
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
  if (failed > 0) {
    throw new StorageDeleteError(failed, deleted, safeErrorCode(firstErrorCode));
  }
  return deleted;
};

export interface PresignPutOptions {
  signingDate?: Date;
  contentLength: number;
  contentType?: string;
  expiresInSeconds?: number;
  key: string;
  target?: StorageTarget;
}

/** maxio (through 0.4.2) splits `X-Amz-SignedHeaders` on `;` without percent-decoding it,
 *  so `content-length%3Bcontent-type%3Bhost` reads as one header and every signature
 *  fails. A literal `;` is valid in a query and SigV4 canonicalizes it back to `%3B`, so
 *  the signature is unchanged and maxio reads each signed header. */
const maxioSignedHeaders = (url: string): string =>
  url.replace(/([?&]X-Amz-SignedHeaders=)([^&#]*)/, (_match, name: string, value: string) => `${name}${value.replace(/%3B/gi, ';')}`);

/** Create a presigned URL a client can PUT bytes to directly (signed with the public endpoint). */
export const presignPutUrl = async ({
  key,
  contentType,
  contentLength,
  expiresInSeconds = UPLOAD_PRESIGN_EXPIRES_IN_SECONDS,
  target,
  signingDate,
}: PresignPutOptions): Promise<string> => {
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > MAX_PRESIGNED_UPLOAD_BYTES) {
    throw new Error('Upload size must be between 1 byte and 50 MiB.');
  }
  const signTarget = target ?? publicTarget();
  const url = await getSignedUrl(
    getS3Client(signTarget),
    new PutObjectCommand({ Bucket: getBucket(signTarget), Key: key, ContentType: contentType, ContentLength: contentLength }),
    {
      expiresIn: Math.min(expiresInSeconds, UPLOAD_PRESIGN_EXPIRES_IN_SECONDS),
      signingDate,
      signableHeaders: new Set(['content-length', 'content-type']),
    },
  );
  // Only the configured default storage has a known provider; explicit targets are signed as is.
  return !target && keys().STORAGE_PROVIDER === 'maxio' ? maxioSignedHeaders(url) : url;
};

export interface PresignGetOptions {
  expiresInSeconds?: number;
  key: string;
  target?: StorageTarget;
}

export const presignGetUrl = ({ key, expiresInSeconds = DEFAULT_PRESIGN_EXPIRES_IN_SECONDS, target }: PresignGetOptions): Promise<string> => {
  const signTarget = target ?? publicTarget();
  return getSignedUrl(getS3Client(signTarget), new GetObjectCommand({ Bucket: getBucket(signTarget), Key: key }), { expiresIn: expiresInSeconds });
};

const trimTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') {
    end -= 1;
  }
  return value.slice(0, end);
};

const trimLeadingSlashes = (value: string): string => {
  let start = 0;
  while (start < value.length && value[start] === '/') {
    start += 1;
  }
  return value.slice(start);
};

export const buildPublicUrl = (key: string, target?: StorageTarget): string => {
  const base = getPublicBaseUrl(target);
  if (!base) {
    throw new Error('No public base URL configured (set STORAGE_PUBLIC_URL or CDN_URL)');
  }
  return `${trimTrailingSlashes(base)}/${trimLeadingSlashes(key)}`;
};

export interface CorsRuleInput {
  allowedHeaders?: string[];
  allowedMethods: string[];
  allowedOrigins: string[];
  exposeHeaders?: string[];
  maxAgeSeconds?: number;
}

export const putBucketCors = async (rules: CorsRuleInput[], target?: StorageTarget): Promise<void> => {
  await getS3Client(target).send(
    new PutBucketCorsCommand({
      Bucket: getBucket(target),
      CORSConfiguration: {
        CORSRules: rules.map((rule) => ({
          AllowedHeaders: rule.allowedHeaders ?? ['*'],
          AllowedMethods: rule.allowedMethods,
          AllowedOrigins: rule.allowedOrigins,
          ExposeHeaders: rule.exposeHeaders ?? [],
          MaxAgeSeconds: rule.maxAgeSeconds,
        })),
      },
    }),
  );
};

/** Allow the given browser origins to upload directly to the bucket. Idempotent. */
export const configureUploadCors = (origins: string[], target?: StorageTarget): Promise<void> =>
  putBucketCors(
    [
      {
        allowedOrigins: origins,
        allowedMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE'],
        allowedHeaders: ['*'],
        exposeHeaders: ['ETag', 'Location'],
        maxAgeSeconds: 3600,
      },
    ],
    target,
  );

export const isNotFound = (error: unknown): boolean => {
  if (!(error instanceof S3ServiceException)) return false;
  return error.name === 'NotFound' || error.name === 'NoSuchKey' || error.$metadata.httpStatusCode === 404;
};
