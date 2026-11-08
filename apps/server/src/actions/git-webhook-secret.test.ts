import { beforeEach, describe, expect, it, vi } from 'vitest';

/** In-memory organization metadata and secret table. A transaction rolls back on error. */
const db = vi.hoisted(() => {
  const state = { metadata: null as string | null, secret: null as string | null, transactions: 0 };
  const hooks: { beforeMetadataWrite?: () => void; failSecretWrite?: Error } = {};
  const prisma = {
    organization: {
      findUnique: vi.fn(async () => ({ metadata: state.metadata })),
      updateMany: vi.fn(async ({ where, data }: { where: { metadata: string | null }; data: { metadata: string } }) => {
        hooks.beforeMetadataWrite?.();
        if (state.metadata !== where.metadata) return { count: 0 };
        state.metadata = data.metadata;
        return { count: 1 };
      }),
      update: vi.fn(),
    },
    organizationGitWebhookSecret: {
      findUnique: vi.fn(async () => (state.secret === null ? null : { secret: state.secret })),
      upsert: vi.fn(async ({ create, update }: { create: { secret: string }; update: { secret?: string } }) => {
        if (hooks.failSecretWrite) throw hooks.failSecretWrite;
        state.secret = state.secret === null ? create.secret : (update.secret ?? state.secret);
        return { secret: state.secret };
      }),
    },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
      state.transactions++;
      const saved = { ...state };
      try {
        return await run(prisma);
      } catch (error) {
        state.metadata = saved.metadata;
        state.secret = saved.secret;
        throw error;
      }
    }),
  };
  return { state, hooks, prisma };
});
const warn = vi.hoisted(() => vi.fn());
vi.mock('@nibleaf/database', () => ({ prisma: db.prisma }));
vi.mock('@nibleaf/logger', () => ({ logger: { warn } }));

import {
  getGitWebhookSecret,
  moveLegacyWebhookSecret,
  readGitWebhookSecret,
  rotateGitWebhookSecret,
  settleGitWebhookSecret,
} from './git-webhook-secret';

const metadataWith = (secret: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ plan: 'free', ...extra, git: { repo: 'acme/docs', webhookSecret: secret } });
/** Valid JSON that PostgreSQL rejects as jsonb (a NUL escape). */
const uncastable = (secret: string) => `{"plan":"free","note":"a\\u0000b","git":{"repo":"acme/docs","webhookSecret":"${secret}"}}`;
const metadata = () => JSON.parse(db.state.metadata ?? 'null');

beforeEach(() => {
  vi.clearAllMocks();
  // Restores the model implementation after a test overrides it.
  db.prisma.organization.updateMany.mockReset();
  db.state.metadata = metadataWith('legacy-secret');
  db.state.secret = null;
  db.state.transactions = 0;
  db.hooks.beforeMetadataWrite = undefined;
  db.hooks.failSecretWrite = undefined;
});

describe('git webhook secret storage', () => {
  it('reads without writing', async () => {
    await expect(readGitWebhookSecret('org-1')).resolves.toMatchObject({ secret: 'legacy-secret', copy: { present: true } });
    expect(db.prisma.organization.updateMany).not.toHaveBeenCalled();
    expect(db.prisma.organizationGitWebhookSecret.upsert).not.toHaveBeenCalled();
  });

  it('adopts a copy and removes only that field, in one transaction', async () => {
    db.state.metadata = metadataWith('legacy-secret', { notifications: { member_joined: false } });
    await expect(getGitWebhookSecret('org-1')).resolves.toBe('legacy-secret');
    expect(db.state.secret).toBe('legacy-secret');
    expect(db.state.transactions).toBe(1);
    expect(metadata()).toEqual({ plan: 'free', notifications: { member_joined: false }, git: { repo: 'acme/docs' } });
    expect(db.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('strips metadata PostgreSQL cannot cast to jsonb', async () => {
    db.state.metadata = uncastable('legacy-secret');
    await expect(getGitWebhookSecret('org-1')).resolves.toBe('legacy-secret');
    expect(db.state.secret).toBe('legacy-secret');
    expect(metadata()).toEqual({ plan: 'free', note: 'a\u0000b', git: { repo: 'acme/docs' } });
  });

  it('never overwrites a concurrent metadata write', async () => {
    db.state.secret = 'stored-secret';
    db.hooks.beforeMetadataWrite = () => {
      db.hooks.beforeMetadataWrite = undefined;
      // An admin saves Git settings between the cleanup's read and its write.
      db.state.metadata = metadataWith('legacy-secret', { branch: 'docs' });
    };
    await getGitWebhookSecret('org-1');
    expect(metadata()).toEqual({ plan: 'free', branch: 'docs', git: { repo: 'acme/docs' } });
  });

  it('keeps the stored secret, removes a differing copy, and logs only the organization', async () => {
    db.state.secret = 'stored-secret';
    db.state.metadata = metadataWith('other-secret');
    await expect(getGitWebhookSecret('org-1')).resolves.toBe('stored-secret');
    expect(db.state.secret).toBe('stored-secret');
    expect(metadata().git).toEqual({ repo: 'acme/docs' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toEqual({ organizationId: 'org-1' });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/stored-secret|other-secret/);
  });

  it('logs and continues when a stored secret exists and the cleanup cannot finish', async () => {
    db.state.secret = 'stored-secret';
    db.prisma.organization.updateMany.mockResolvedValue({ count: 0 });
    await expect(getGitWebhookSecret('org-1')).resolves.toBe('stored-secret');
    expect(warn).toHaveBeenCalledWith({ organizationId: 'org-1' }, expect.any(String));
  });

  it('logs and continues when a stored secret exists and the cleanup errors', async () => {
    db.state.secret = 'stored-secret';
    db.prisma.organization.updateMany.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(getGitWebhookSecret('org-1')).resolves.toBe('stored-secret');
    expect(warn).toHaveBeenCalledWith({ organizationId: 'org-1' }, expect.any(String));
  });

  it('rolls an adoption back when the cleanup cannot finish, and keeps verifying with the copy', async () => {
    db.prisma.organization.updateMany.mockResolvedValue({ count: 0 });
    const read = await readGitWebhookSecret('org-1');
    await expect(settleGitWebhookSecret(read)).resolves.toBe('legacy-secret');
    expect(db.state.secret).toBeNull();
    expect(metadata().git).toEqual({ repo: 'acme/docs', webhookSecret: 'legacy-secret' });
  });

  it('removes an unusable copy without adopting it', async () => {
    db.state.metadata = metadataWith('');
    await expect(getGitWebhookSecret('org-1')).resolves.toBeNull();
    expect(db.state.secret).toBeNull();
    expect(metadata().git).toEqual({ repo: 'acme/docs' });
  });

  it('writes nothing when metadata holds no copy', async () => {
    db.state.secret = 'stored-secret';
    db.state.metadata = JSON.stringify({ git: { repo: 'acme/docs' } });
    await expect(getGitWebhookSecret('org-1')).resolves.toBe('stored-secret');
    expect(db.prisma.organization.updateMany).not.toHaveBeenCalled();
    expect(db.state.transactions).toBe(0);
  });

  describe('before a caller writes the metadata document back', () => {
    it('removes the field once the secret is stored', async () => {
      const document: Record<string, unknown> = { git: { repo: 'acme/docs', webhookSecret: 'legacy-secret' } };
      await moveLegacyWebhookSecret('org-1', document);
      expect(document).toEqual({ git: { repo: 'acme/docs' } });
      expect(db.state.secret).toBe('legacy-secret');
    });

    it('keeps the only copy of a secret that could not be stored', async () => {
      db.prisma.organization.updateMany.mockResolvedValue({ count: 0 });
      const document: Record<string, unknown> = { git: { repo: 'acme/docs', webhookSecret: 'legacy-secret' } };
      await moveLegacyWebhookSecret('org-1', document);
      expect(document).toEqual({ git: { repo: 'acme/docs', webhookSecret: 'legacy-secret' } });
      expect(db.state.secret).toBeNull();
    });
  });

  describe('rotation', () => {
    it('stores the new secret and removes the metadata copy', async () => {
      const secret = await rotateGitWebhookSecret('org-1');
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      expect(db.state.secret).toBe(secret);
      expect(metadata().git).toEqual({ repo: 'acme/docs' });
    });

    it('commits even when the metadata cleanup fails', async () => {
      db.state.metadata = uncastable('legacy-secret');
      db.prisma.organization.updateMany.mockRejectedValueOnce(new Error('invalid input syntax for type json'));
      const secret = await rotateGitWebhookSecret('org-1');
      expect(db.state.secret).toBe(secret);
      expect(warn).toHaveBeenCalledWith({ organizationId: 'org-1' }, expect.any(String));
    });

    it('rotates metadata PostgreSQL cannot cast to jsonb', async () => {
      db.state.metadata = uncastable('legacy-secret');
      const secret = await rotateGitWebhookSecret('org-1');
      expect(db.state.secret).toBe(secret);
      expect(metadata().git).toEqual({ repo: 'acme/docs' });
    });
  });
});
