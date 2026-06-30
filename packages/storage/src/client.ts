import { S3Client } from '@aws-sdk/client-s3';
import { logger } from '@midad/logger';
import { keys } from './keys';

export interface StorageTarget {
  accessKeyId: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle: boolean;
  publicUrl?: string;
  region: string;
  secretAccessKey: string;
}

const clientCache = new Map<string, S3Client>();
const cacheKey = (t: StorageTarget): string => `${t.endpoint ?? ''}|${t.region}|${t.forcePathStyle}|${t.accessKeyId}`;

/** The env-configured default target (local MinIO in dev, or the configured cloud bucket). */
export const defaultTarget = (): StorageTarget => {
  const env = keys();
  return {
    endpoint: env.STORAGE_ENDPOINT,
    region: env.STORAGE_REGION,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    bucket: env.STORAGE_BUCKET,
    publicUrl: env.CDN_URL ?? env.STORAGE_PUBLIC_URL,
  };
};

/**
 * Target used for SIGNING presigned URLs: identical to {@link defaultTarget} but
 * with the browser-reachable STORAGE_PUBLIC_ENDPOINT (when set), so presigned
 * upload/download URLs point at a host the browser can reach — not the internal
 * docker hostname used for server→storage calls.
 */
export const publicTarget = (): StorageTarget => {
  const env = keys();
  const base = defaultTarget();
  return env.STORAGE_PUBLIC_ENDPOINT ? { ...base, endpoint: env.STORAGE_PUBLIC_ENDPOINT } : base;
};

/** Lazily construct and cache an S3Client for a target (defaults to the env target). */
export const getS3Client = (target?: StorageTarget): S3Client => {
  const resolved = target ?? defaultTarget();
  const key = cacheKey(resolved);
  const cached = clientCache.get(key);
  if (cached) {
    return cached;
  }
  logger.debug({ endpoint: resolved.endpoint, region: resolved.region, bucket: resolved.bucket }, 'creating s3 client');
  const client = new S3Client({
    endpoint: resolved.endpoint,
    region: resolved.region,
    forcePathStyle: resolved.forcePathStyle,
    credentials: { accessKeyId: resolved.accessKeyId, secretAccessKey: resolved.secretAccessKey },
  });
  clientCache.set(key, client);
  return client;
};

export const getBucket = (target?: StorageTarget): string => target?.bucket ?? keys().STORAGE_BUCKET;

export const getPublicBaseUrl = (target?: StorageTarget): string | undefined => {
  if (target) {
    return target.publicUrl;
  }
  const env = keys();
  return env.CDN_URL ?? env.STORAGE_PUBLIC_URL;
};
