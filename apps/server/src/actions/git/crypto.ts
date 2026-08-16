import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { badRequest } from '@/errors';

const VERSION = 'v1';

const encryptionKey = (encoded = process.env.GIT_CREDENTIAL_ENCRYPTION_KEY): Buffer => {
  if (!encoded) {
    throw badRequest('Git credential encryption is not configured. Set GIT_CREDENTIAL_ENCRYPTION_KEY.');
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw badRequest('GIT_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
};

/** AES-256-GCM envelope. The versioned single-column format allows future key
 * rotation without ever exposing provider credentials to Prisma or logs. */
export const encryptGitSecret = (plaintext: string, encodedKey?: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(encodedKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
};

export const decryptGitSecret = (envelope: string, encodedKey?: string): string => {
  const [version, ivRaw, tagRaw, ciphertextRaw, extra] = envelope.split('.');
  if (version !== VERSION || !ivRaw || !tagRaw || !ciphertextRaw || extra) {
    throw new Error('Unsupported encrypted Git secret envelope.');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(encodedKey), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextRaw, 'base64url')), decipher.final()]).toString('utf8');
};

/** Non-secret display fingerprint. It cannot be used to recover or authenticate
 * with the credential and is safe to expose in connection status responses. */
export const gitCredentialFingerprint = (token: string): string => createHash('sha256').update(token).digest('hex').slice(0, 12);
