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
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '@nibleaf/logger';
import { getBucket, getPublicBaseUrl, getS3Client, publicTarget, type StorageTarget } from './client';

export { defaultTarget, getBucket, getPublicBaseUrl, getS3Client, publicTarget, type StorageTarget } from './client';

const DELETE_BATCH_SIZE = 1000;
const DEFAULT_EXPIRES_IN_SECONDS = 3600;

/** Create the bucket if it does not exist yet (idempotent; used on API boot for self-host). */
export const ensureBucket = async (target?: StorageTarget): Promise<void> => {
  const client = getS3Client(target);
  const bucket = getBucket(target);
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      logger.info({ bucket }, 'created storage bucket');
    } catch (error) {
      logger.warn({ error, bucket }, 'could not ensure storage bucket (may already exist or be managed externally)');
    }
  }
};

export const putObject = async (key: string, body: Buffer | Uint8Array | string, contentType?: string, target?: StorageTarget): Promise<void> => {
  await getS3Client(target).send(new PutObjectCommand({ Bucket: getBucket(target), Key: key, Body: body, ContentType: contentType }));
};

export const getObjectStream = async (key: string, target?: StorageTarget): Promise<Readable> => {
  const result = await getS3Client(target).send(new GetObjectCommand({ Bucket: getBucket(target), Key: key }));
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

export const deletePrefix = async (prefix: string, target?: StorageTarget): Promise<number> => {
  const client = getS3Client(target);
  const bucket = getBucket(target);
  let continuationToken: string | undefined;
  let deleted = 0;
  do {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }));
    const identifiers: ObjectIdentifier[] = (listed.Contents ?? []).flatMap((object) => (object.Key ? [{ Key: object.Key }] : []));
    for (let i = 0; i < identifiers.length; i += DELETE_BATCH_SIZE) {
      const batch = identifiers.slice(i, i + DELETE_BATCH_SIZE);
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch, Quiet: true } }));
      deleted += batch.length;
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
  return deleted;
};

export interface PresignPutOptions {
  contentType?: string;
  expiresInSeconds?: number;
  key: string;
  target?: StorageTarget;
}

/** Create a presigned URL a client can PUT bytes to directly (signed with the public endpoint). */
export const presignPutUrl = ({ key, contentType, expiresInSeconds = DEFAULT_EXPIRES_IN_SECONDS, target }: PresignPutOptions): Promise<string> => {
  const signTarget = target ?? publicTarget();
  return getSignedUrl(getS3Client(signTarget), new PutObjectCommand({ Bucket: getBucket(signTarget), Key: key, ContentType: contentType }), {
    expiresIn: expiresInSeconds,
  });
};

export interface PresignGetOptions {
  expiresInSeconds?: number;
  key: string;
  target?: StorageTarget;
}

export const presignGetUrl = ({ key, expiresInSeconds = DEFAULT_EXPIRES_IN_SECONDS, target }: PresignGetOptions): Promise<string> => {
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

const isNotFound = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { name, $metadata } = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return name === 'NotFound' || name === 'NoSuchKey' || $metadata?.httpStatusCode === 404;
};
