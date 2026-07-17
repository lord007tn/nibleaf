import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/database', () => ({ prisma: {}, Prisma: { PrismaClientKnownRequestError: class extends Error {} } }));
vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), QueueNames: { PUBLISH: 'publish' } }));

import { extractPushBranch, generateWebhookSecret, verifyGitHubSignature, verifyGitLabToken } from './git-webhook';

const SECRET = 'a'.repeat(64);
const sign = (body: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;

describe('verifyGitHubSignature', () => {
  const body = JSON.stringify({ ref: 'refs/heads/main', head_commit: { id: 'abc123' } });

  it('accepts a valid X-Hub-Signature-256 over the raw body', () => {
    expect(verifyGitHubSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('accepts uppercase hex digests', () => {
    const upper = `sha256=${sign(body).slice('sha256='.length).toUpperCase()}`;
    expect(verifyGitHubSignature(body, upper, SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const tampered = body.replace('refs/heads/main', 'refs/heads/evil');
    expect(verifyGitHubSignature(tampered, sign(body), SECRET)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    expect(verifyGitHubSignature(body, sign(body, 'b'.repeat(64)), SECRET)).toBe(false);
  });

  it('rejects a missing or malformed header', () => {
    expect(verifyGitHubSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyGitHubSignature(body, '', SECRET)).toBe(false);
    expect(verifyGitHubSignature(body, sign(body).slice('sha256='.length), SECRET)).toBe(false); // no sha256= prefix
    expect(verifyGitHubSignature(body, `sha1=${'0'.repeat(40)}`, SECRET)).toBe(false);
  });

  it('rejects when no secret is configured', () => {
    expect(verifyGitHubSignature(body, sign(body, ''), '')).toBe(false);
  });
});

describe('verifyGitLabToken', () => {
  it('accepts the exact secret', () => {
    expect(verifyGitLabToken(SECRET, SECRET)).toBe(true);
  });

  it('rejects a wrong or truncated token', () => {
    expect(verifyGitLabToken('b'.repeat(64), SECRET)).toBe(false);
    expect(verifyGitLabToken(SECRET.slice(0, 63), SECRET)).toBe(false);
    expect(verifyGitLabToken(`${SECRET}x`, SECRET)).toBe(false);
  });

  it('rejects a missing token and an empty secret', () => {
    expect(verifyGitLabToken(undefined, SECRET)).toBe(false);
    expect(verifyGitLabToken('', SECRET)).toBe(false);
    expect(verifyGitLabToken('', '')).toBe(false);
  });
});

describe('extractPushBranch', () => {
  it('extracts the branch from a push ref (nested branch names included)', () => {
    expect(extractPushBranch({ ref: 'refs/heads/main' })).toBe('main');
    expect(extractPushBranch({ ref: 'refs/heads/feat/docs-sync' })).toBe('feat/docs-sync');
  });

  it('returns null for tag pushes and non-push payloads', () => {
    expect(extractPushBranch({ ref: 'refs/tags/v1.0.0' })).toBeNull();
    expect(extractPushBranch({ ref: 'refs/heads/' })).toBeNull();
    expect(extractPushBranch({ zen: 'Keep it logically awesome.' })).toBeNull();
    expect(extractPushBranch(null)).toBeNull();
    expect(extractPushBranch('refs/heads/main')).toBeNull();
  });
});

describe('generateWebhookSecret', () => {
  it('produces unique 64-char hex secrets', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
