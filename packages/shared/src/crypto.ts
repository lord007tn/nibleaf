import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** SHA-256 hex hash of an API key secret. Only the hash is persisted. */
export const hashApiKeySecret = (secret: string): string => createHash('sha256').update(secret).digest('hex');

/** HMAC-SHA256 signature for webhook payloads (hex). */
export const signPayload = (body: string, secret: string): string => createHmac('sha256', secret).update(body).digest('hex');

/** Constant-time comparison of two hex signatures. */
export const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};
