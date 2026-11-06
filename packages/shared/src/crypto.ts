import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const decodeEncryptionKey = (encoded: string) => {
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('Integration credential encryption requires a base64-encoded 32-byte key.');
  return key;
};

export const encryptionKeyId = (key: Buffer) => createHash('sha256').update(key).digest('base64url').slice(0, 12);

/** Shared API/worker envelope. Credentials never belong in public configuration. */
export const encryptSecret = (plaintext: string, key: Buffer) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', encryptionKeyId(key), iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join(
    '.',
  );
};

export const decryptSecret = (envelope: string, keys: Buffer[]) => {
  const [version, keyId, iv, tag, ciphertext, extra] = envelope.split('.');
  if (version !== 'v1' || !keyId || !iv || !tag || !ciphertext || extra) throw new Error('Unsupported integration credential envelope.');
  const key = keys.find((candidate) => encryptionKeyId(candidate) === keyId);
  if (!key) throw new Error('Integration credential key is unavailable.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
};

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
