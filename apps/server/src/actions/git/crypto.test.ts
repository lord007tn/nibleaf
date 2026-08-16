import { describe, expect, it } from 'vitest';
import { decryptGitSecret, encryptGitSecret, gitCredentialFingerprint } from './crypto';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('Git secret encryption', () => {
  it('round-trips without embedding plaintext and uses a randomized envelope', () => {
    const first = encryptGitSecret('github_pat_secret', KEY);
    const second = encryptGitSecret('github_pat_secret', KEY);
    expect(first).not.toContain('github_pat_secret');
    expect(first).not.toBe(second);
    expect(decryptGitSecret(first, KEY)).toBe('github_pat_secret');
  });

  it('rejects tampered ciphertext', () => {
    const encrypted = encryptGitSecret('secret', KEY);
    const parts = encrypted.split('.');
    const ciphertext = Buffer.from(parts[3] as string, 'base64url');
    ciphertext[0] = (ciphertext[0] as number) ^ 1;
    parts[3] = ciphertext.toString('base64url');
    expect(() => decryptGitSecret(parts.join('.'), KEY)).toThrow();
  });

  it('requires exactly 32 bytes and exposes only a bounded fingerprint', () => {
    expect(() => encryptGitSecret('secret', Buffer.alloc(16).toString('base64'))).toThrow(/32-byte/);
    expect(gitCredentialFingerprint('github_pat_secret')).toMatch(/^[a-f0-9]{12}$/);
  });
});
