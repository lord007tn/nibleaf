import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { env } from '@/env';
import { AppError } from '@/errors';

const ENVELOPE_VERSION = 'v1';

interface IntegrationKeyringOptions {
  current?: string;
  previous?: string[];
}

export type IntegrationDigestPurpose = 'confirmation' | 'idempotency-key' | 'request';

const decodeKey = (encoded: string) => {
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw new AppError({
      code: 'integration:provider_unavailable',
      message: 'Integration credential encryption requires a base64-encoded 32-byte key.',
    });
  }
  return key;
};

const keyId = (key: Buffer) => createHash('sha256').update(key).digest('base64url').slice(0, 12);

const keyring = (options?: IntegrationKeyringOptions) => {
  const currentEncoded = options?.current ?? env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY;
  if (!currentEncoded) {
    throw new AppError({
      code: 'integration:provider_unavailable',
      message: 'Integration credential encryption is not configured.',
    });
  }
  const current = decodeKey(currentEncoded);
  const previous = (options?.previous ?? env.INTEGRATION_CREDENTIAL_PREVIOUS_KEYS).map(decodeKey);
  return { current, keys: [current, ...previous] };
};

/** Versioned AES-256-GCM envelope with a non-secret key id for dual-read,
 * single-write key rotation. */
export const encryptIntegrationSecret = (plaintext: string, options?: IntegrationKeyringOptions) => {
  const { current } = keyring(options);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', current, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    ENVELOPE_VERSION,
    keyId(current),
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
};

export const decryptIntegrationSecret = (envelope: string, options?: IntegrationKeyringOptions) => {
  const [version, envelopeKeyId, ivRaw, tagRaw, ciphertextRaw, extra] = envelope.split('.');
  if (version !== ENVELOPE_VERSION || !envelopeKeyId || !ivRaw || !tagRaw || !ciphertextRaw || extra) {
    throw new Error('Unsupported integration credential envelope.');
  }
  const { keys } = keyring(options);
  const key = keys.find((candidate) => keyId(candidate) === envelopeKeyId);
  if (!key) throw new Error('Integration credential key is unavailable.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextRaw, 'base64url')), decipher.final()]).toString('utf8');
};

const digestWithKey = (key: Buffer, purpose: IntegrationDigestPurpose, value: string) =>
  createHmac('sha256', key).update(`nibleaf:integration:${purpose}:v1\0`).update(value).digest('hex');

/** Digest caller values before persistence. Purpose separation prevents a
 * digest from one boundary being reusable at another boundary. New values are
 * written with the current key. */
export const digestIntegrationValue = (value: string, purpose: IntegrationDigestPurpose, options?: IntegrationKeyringOptions) => {
  const { current } = keyring(options);
  return digestWithKey(current, purpose, value);
};

/** Current and previous-key candidates keep bounded ledgers and confirmations
 * readable during dual-read/single-write key rotation. */
export const digestIntegrationValueCandidates = (value: string, purpose: IntegrationDigestPurpose, options?: IntegrationKeyringOptions) => {
  const { keys } = keyring(options);
  return keys.map((key) => digestWithKey(key, purpose, value));
};

export const newIntegrationConfirmationToken = () => randomBytes(32).toString('base64url');
