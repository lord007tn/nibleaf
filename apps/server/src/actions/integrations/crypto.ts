import { createHmac, randomBytes } from 'node:crypto';
import { decodeEncryptionKey, decryptSecret, encryptSecret } from '@nibleaf/shared/crypto';
import { env } from '@/env';
import { AppError } from '@/errors';

interface IntegrationKeyringOptions {
  current?: string;
  previous?: string[];
}

export type IntegrationDigestPurpose = 'confirmation' | 'idempotency-key' | 'request';

const decodeKey = (encoded: string) => {
  try {
    return decodeEncryptionKey(encoded);
  } catch {
    throw new AppError({
      code: 'integration:provider_unavailable',
      message: 'Integration credential encryption requires a base64-encoded 32-byte key.',
    });
  }
};

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
export const encryptIntegrationSecret = (plaintext: string, options?: IntegrationKeyringOptions) =>
  encryptSecret(plaintext, keyring(options).current);

export const decryptIntegrationSecret = (envelope: string, options?: IntegrationKeyringOptions) => decryptSecret(envelope, keyring(options).keys);

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
