import { customAlphabet, nanoid } from 'nanoid';
import { API_KEY_PREFIX } from './constants';

const SECRET_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const secretGen = customAlphabet(SECRET_ALPHABET, 32);

/** A short, url-safe id with an optional human-readable prefix. */
export const newId = (prefix?: string): string => (prefix ? `${prefix}_${nanoid(20)}` : nanoid(20));

/**
 * Mint a new API key secret of the form `plm_<live|test>_<32 chars>`. The full
 * secret is shown once to the user; only its hash is stored (see crypto.ts).
 */
export const newApiKeySecret = (env: 'live' | 'test' = 'live'): { secret: string } => ({
  secret: `${API_KEY_PREFIX}_${env}_${secretGen()}`,
});

/** Random hex token (e.g. for domain verification). */
export const newToken = (size = 24): string => customAlphabet('0123456789abcdef', size)();
