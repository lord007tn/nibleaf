import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiKeyFindFirst: vi.fn(),
  assertProjectAccess: vi.fn(),
  auditCreate: vi.fn(),
  confirmationCreate: vi.fn(),
  confirmationDeleteMany: vi.fn(),
  confirmationFindFirst: vi.fn(),
  confirmationUpdateMany: vi.fn(),
  deliveryCreate: vi.fn(),
  deliveryFindFirst: vi.fn(),
  deliveryUpdate: vi.fn(),
  deliveryUpdateMany: vi.fn(),
  gitConnectionFindUnique: vi.fn(),
  idempotencyCreate: vi.fn(),
  idempotencyDeleteMany: vi.fn(),
  idempotencyFindFirst: vi.fn(),
  integrationCreate: vi.fn(),
  integrationDelete: vi.fn(),
  integrationFindUnique: vi.fn(),
  integrationFindMany: vi.fn(),
  integrationUpdateManyAndReturn: vi.fn(),
  projectFindUnique: vi.fn(),
  transaction: vi.fn(),
  verifyWebhookProvider: vi.fn(),
}));

vi.mock('@/env', () => ({
  env: {
    INTEGRATION_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString('base64'),
    INTEGRATION_CREDENTIAL_PREVIOUS_KEYS: [],
    INTEGRATION_CONFIRMATION_TTL_SECONDS: 300,
    INTEGRATION_CONFIRMATION_RETENTION_HOURS: 24,
    INTEGRATION_IDEMPOTENCY_TTL_HOURS: 24,
    OPENROUTER_API_KEY: undefined,
    POSTMARK_API_KEY: undefined,
    POSTMARK_MESSAGE_STREAM: undefined,
    SMTP_URL: undefined,
    CUSTOM_DOMAIN_PROVIDER: 'noop',
    CLOUDFLARE_SAAS_ZONE_ID: undefined,
    CLOUDFLARE_SAAS_API_TOKEN: undefined,
    CLOUDFLARE_SAAS_WORKER_SCRIPT: 'site-router',
    AI_DRAFT_MODEL: 'openai/model',
  },
}));

const runtime = vi.hoisted(() => ({
  /** SEARCH_ANSWER_ENABLED: whether the server allows AI answers at all. */
  answersEnabled: false,
  /** SEARCH_EMBEDDING_MODEL: what a stored AI key must be built for. */
  embeddingModel: 'embedding',
  /**
   * The webhook lifecycle stays in place for publish delivery
   * (operations/ux/ai-and-integrations.md, PR 7). The durability tests run it
   * as if delivery were live; the shipped catalog marks Slack, Discord and
   * Zapier "coming soon", which the "coming soon" tests below use as is.
   */
  webhooksLive: true,
}));

vi.mock('@nibleaf/shared/integrations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nibleaf/shared/integrations')>();
  const live = <T extends { comingSoon: boolean }>(manifest: T): T =>
    manifest.comingSoon && runtime.webhooksLive ? { ...manifest, comingSoon: false } : manifest;
  return {
    ...actual,
    get INTEGRATION_CATALOG() {
      return actual.INTEGRATION_CATALOG.map(live);
    },
    getIntegrationManifest: (providerId: Parameters<typeof actual.getIntegrationManifest>[0]) => {
      const manifest = actual.getIntegrationManifest(providerId);
      return manifest && live(manifest);
    },
  };
});
vi.mock('@nibleaf/clickhouse/keys', () => ({ keys: () => ({ ANALYTICS_MODE: 'disabled' }) }));
vi.mock('@nibleaf/qdrant/keys', () => ({ keys: () => ({ QDRANT_URL: undefined }) }));
vi.mock('@nibleaf/search/keys', () => ({
  keys: () => ({
    SEARCH_RUNTIME: 'legacy',
    SEARCH_EMBEDDING_MODEL: runtime.embeddingModel,
    SEARCH_ANSWER_MODEL: 'answer',
    SEARCH_ANSWER_ENABLED: runtime.answersEnabled,
  }),
}));
vi.mock('@nibleaf/storage/keys', () => ({ keys: () => ({ STORAGE_PROVIDER: 'minio' }) }));

vi.mock('@nibleaf/database', () => {
  class PrismaClientKnownRequestError extends Error {
    code = 'P2002';
  }
  return {
    Prisma: { PrismaClientKnownRequestError },
    prisma: {
      apiKey: { findFirst: mocks.apiKeyFindFirst },
      gitConnection: { findUnique: mocks.gitConnectionFindUnique },
      integrationConfirmation: { findFirst: mocks.confirmationFindFirst },
      integrationIdempotencyRecord: { findFirst: mocks.idempotencyFindFirst },
      integrationWebhookDelivery: {
        create: mocks.deliveryCreate,
        findFirst: mocks.deliveryFindFirst,
        update: mocks.deliveryUpdate,
        updateMany: mocks.deliveryUpdateMany,
      },
      project: { findUnique: mocks.projectFindUnique },
      projectIntegration: { findMany: mocks.integrationFindMany, findUnique: mocks.integrationFindUnique },
      $transaction: mocks.transaction,
    },
  };
});

vi.mock('../projects', () => ({ assertProjectAccess: mocks.assertProjectAccess }));
vi.mock('../workspace', () => ({
  parseWorkspaceMetadata: (raw: string | null) => (raw ? JSON.parse(raw) : { git: {} }),
}));
vi.mock('../git/crypto', () => ({ decryptGitSecret: () => 'token' }));
vi.mock('../git/github', () => ({
  GitHubProvider: class {
    verifyIdentity = vi.fn();
    verifyWriteAccess = vi.fn();
  },
}));
vi.mock('./providers', () => ({ verifyWebhookProvider: mocks.verifyWebhookProvider }));

import { Prisma } from '@nibleaf/database';
import { env } from '@/env';
import { digestIntegrationValue, encryptIntegrationSecret } from './crypto';
import {
  activateProjectIntegration,
  createIntegrationDeleteConfirmation,
  createProjectIntegration,
  deactivateProjectIntegration,
  deleteProjectIntegration,
  getProjectIntegration,
  listProjectIntegrations,
  updateProjectIntegration,
  verifyProjectIntegration,
} from './index';

const now = new Date('2026-08-23T12:00:00.000Z');
const connection = (revision = 1) => ({
  id: 'connection-1',
  projectId: 'project-1',
  providerId: 'slack',
  status: 'ACTIVE',
  config: { label: 'Alerts' },
  credentialEncrypted: 'encrypted',
  revision,
  lastVerificationStatus: 'UNVERIFIED',
  lastVerificationCode: null,
  lastVerifiedAt: null,
  createdById: 'user-1',
  createdAt: now,
  updatedAt: now,
});

const context = (apiKeyScopes?: string[]) =>
  ({
    get: (key: string) => {
      if (key === 'apiKey') return apiKeyScopes ? { id: 'key-1', projectId: 'project-1', scopes: apiKeyScopes } : null;
      if (key === 'user') return apiKeyScopes ? null : { id: 'user-1' };
      if (key === 'locale') return 'en';
      return null;
    },
  }) as never;

describe('integration lifecycle durability', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.assertProjectAccess.mockResolvedValue({ organizationId: 'org-1', role: 'admin' });
    mocks.transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback({
        integrationAuditEvent: { create: mocks.auditCreate },
        integrationConfirmation: {
          create: mocks.confirmationCreate,
          deleteMany: mocks.confirmationDeleteMany,
          findFirst: mocks.confirmationFindFirst,
          updateMany: mocks.confirmationUpdateMany,
        },
        integrationWebhookDelivery: { update: mocks.deliveryUpdate, updateMany: mocks.deliveryUpdateMany },
        integrationIdempotencyRecord: { create: mocks.idempotencyCreate, deleteMany: mocks.idempotencyDeleteMany },
        projectIntegration: {
          create: mocks.integrationCreate,
          delete: mocks.integrationDelete,
          findUnique: mocks.integrationFindUnique,
          updateManyAndReturn: mocks.integrationUpdateManyAndReturn,
        },
      }),
    );
    mocks.idempotencyDeleteMany.mockResolvedValue({ count: 0 });
    mocks.confirmationDeleteMany.mockResolvedValue({ count: 0 });
    mocks.confirmationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.deliveryUpdateMany.mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' });
    mocks.gitConnectionFindUnique.mockResolvedValue(null);
    mocks.integrationFindMany.mockResolvedValue([]);
    mocks.projectFindUnique.mockResolvedValue({
      id: 'project-1',
      organizationId: 'org-1',
      createdAt: now,
      config: null,
      gitSettings: { settings: {} },
    });
  });

  it('replays the exact secret-free result after later mutation and deletion', async () => {
    let record: { requestDigest: string; result: unknown; expiresAt: Date } | null = null;
    mocks.idempotencyFindFirst.mockImplementation(() => record);
    mocks.integrationFindUnique.mockResolvedValue(null);
    mocks.integrationCreate.mockResolvedValue(connection());
    mocks.idempotencyCreate.mockImplementation(({ data }) => {
      record = { requestDigest: data.requestDigest, result: data.result, expiresAt: data.expiresAt };
      return record;
    });

    const body = {
      providerId: 'slack' as const,
      webhookUrl: 'https://hooks.slack.com/services/T1/B1/secret',
      label: 'Alerts',
      idempotencyKey: 'create-key-1',
    };
    const first = await createProjectIntegration(context(), 'project-1', body);
    mocks.integrationFindUnique.mockResolvedValue(connection(9));
    const replay = await createProjectIntegration(context(), 'project-1', {
      idempotencyKey: body.idempotencyKey,
      label: body.label,
      webhookUrl: body.webhookUrl,
      providerId: body.providerId,
    });

    expect(replay).toEqual(first);
    expect(replay.revision).toBe(1);
    expect(JSON.stringify(record)).not.toContain(body.webhookUrl);
    expect(mocks.integrationCreate).toHaveBeenCalledTimes(1);
    await expect(
      createProjectIntegration(context(), 'project-1', {
        idempotencyKey: body.idempotencyKey,
        providerId: body.providerId,
        webhookUrl: 'https://hooks.slack.com/services/T1/B1/changed',
        label: body.label,
      }),
    ).rejects.toMatchObject({ code: 'integration:idempotency_conflict' });
  });

  it('does not relabel an unknown database failure as a business conflict', async () => {
    mocks.idempotencyFindFirst.mockResolvedValue(null);
    mocks.integrationFindUnique.mockResolvedValue(null);
    const outage = new Error('database unavailable');
    mocks.integrationCreate.mockRejectedValue(outage);

    await expect(
      createProjectIntegration(context(), 'project-1', {
        providerId: 'slack',
        webhookUrl: 'https://hooks.slack.com/services/T1/B1/secret',
        idempotencyKey: 'create-key-2',
      }),
    ).rejects.toBe(outage);

    const KnownError = Prisma.PrismaClientKnownRequestError as unknown as new () => Error;
    mocks.integrationCreate.mockRejectedValue(new KnownError());
    await expect(
      createProjectIntegration(context(), 'project-1', {
        providerId: 'slack',
        webhookUrl: 'https://hooks.slack.com/services/T1/B1/secret',
        idempotencyKey: 'create-key-3',
      }),
    ).rejects.toMatchObject({ code: 'integration:already_connected' });
  });

  it('digests idempotency keys separately from canonical request bodies', async () => {
    mocks.idempotencyFindFirst.mockResolvedValue(null);
    mocks.integrationFindUnique.mockResolvedValue(null);
    mocks.integrationCreate.mockResolvedValue(connection());
    mocks.idempotencyCreate.mockResolvedValue({});
    const shared = {
      providerId: 'slack' as const,
      webhookUrl: 'https://hooks.slack.com/services/T1/B1/separate-key',
      label: 'Alerts',
    };

    await createProjectIntegration(context(), 'project-1', { ...shared, idempotencyKey: 'separate-key-1' });
    await createProjectIntegration(context(), 'project-1', { idempotencyKey: 'separate-key-2', ...shared });

    const [first, second] = mocks.idempotencyCreate.mock.calls.map((call) => call[0].data);
    expect(first.requestDigest).toBe(second.requestDigest);
    expect(first.keyDigest).not.toBe(second.keyDigest);
  });

  it('reloads API keys with expiry and rejects legacy wildcard mutation scope', async () => {
    mocks.apiKeyFindFirst.mockResolvedValue({
      id: 'key-1',
      projectId: 'project-1',
      scopes: ['*'],
      project: { organizationId: 'org-1' },
    });

    await expect(
      deactivateProjectIntegration(context(['*']), 'project-1', 'slack', {
        expectedRevision: 1,
        idempotencyKey: 'status-key-1',
      }),
    ).rejects.toMatchObject({ code: 'auth:insufficient_role' });
    expect(mocks.apiKeyFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        }),
      }),
    );
  });

  it('requires admins for mutations and hides cross-tenant projects behind not-found', async () => {
    mocks.assertProjectAccess.mockResolvedValueOnce({ organizationId: 'org-1', role: 'member' });
    await expect(
      createProjectIntegration(context(), 'project-1', {
        providerId: 'slack',
        webhookUrl: 'https://hooks.slack.com/services/T1/B1/secret',
        idempotencyKey: 'member-key-1',
      }),
    ).rejects.toMatchObject({ code: 'auth:insufficient_role' });
    expect(mocks.integrationCreate).not.toHaveBeenCalled();

    mocks.assertProjectAccess.mockRejectedValueOnce({ code: 'database:not_found' });
    await expect(listProjectIntegrations(context(), 'other-project')).rejects.toMatchObject({ code: 'database:not_found' });
    expect(mocks.projectFindUnique).not.toHaveBeenCalled();
  });

  it('redacts credentials, unknown config, and raw provider status from list and get', async () => {
    mocks.integrationFindMany.mockResolvedValue([
      {
        ...connection(),
        credentialEncrypted: 'raw-encrypted-secret',
        config: { label: 'Alerts', providerPayload: { token: 'provider-secret' } },
        lastVerificationStatus: 'UNHEALTHY',
        lastVerificationCode: 'raw provider response',
      },
    ]);

    const catalog = await listProjectIntegrations(context(), 'project-1');
    const slack = catalog.find(({ id }) => id === 'slack');
    expect(slack?.connection).toMatchObject({
      credential: { configured: true },
      config: { providerId: 'slack', label: null },
      health: { code: null },
    });
    expect(JSON.stringify(slack)).not.toContain('raw-encrypted-secret');
    expect(JSON.stringify(slack)).not.toContain('provider-secret');
    expect(JSON.stringify(slack)).not.toContain('raw provider response');

    const detail = await getProjectIntegration(context(), 'project-1', 'slack');
    expect(detail).toEqual(slack);
  });

  it('sanitizes credential-bearing legacy Git clone URLs in list and get projections', async () => {
    mocks.projectFindUnique.mockResolvedValue({
      id: 'project-1',
      organizationId: 'org-1',
      createdAt: now,
      config: null,
      gitSettings: {
        settings: {
          provider: 'git',
          connected: true,
          cloneUrl: 'https://token@git.example.com/acme/docs.git?access_token=provider-secret#fragment',
          branch: 'main',
        },
      },
    });

    const catalog = await listProjectIntegrations(context(), 'project-1');
    const publicGit = catalog.find(({ id }) => id === 'public-git');
    expect(publicGit?.connection?.config).toMatchObject({
      providerId: 'public-git',
      repository: 'git.example.com/acme/docs.git',
    });
    expect(JSON.stringify(publicGit)).not.toContain('token@');
    expect(JSON.stringify(publicGit)).not.toContain('access_token');
    expect(JSON.stringify(publicGit)).not.toContain('provider-secret');

    const detail = await getProjectIntegration(context(), 'project-1', 'public-git');
    expect(detail).toEqual(publicGit);
  });

  it('keeps replaced credentials write-only in update results and audit metadata', async () => {
    mocks.idempotencyFindFirst.mockResolvedValue(null);
    mocks.integrationFindUnique.mockResolvedValue(connection());
    mocks.integrationUpdateManyAndReturn.mockImplementation(({ data }) => [
      { ...connection(2), ...data, credentialEncrypted: 'new-encrypted-envelope', revision: 2 },
    ]);
    mocks.idempotencyCreate.mockResolvedValue({});
    const webhookUrl = 'https://hooks.slack.com/services/T2/B2/replacement';

    const result = await updateProjectIntegration(context(), 'project-1', 'slack', {
      providerId: 'slack',
      webhookUrl,
      replaceCredential: true,
      label: 'Security alerts',
      expectedRevision: 1,
      idempotencyKey: 'update-key-1',
    });

    expect(result).toMatchObject({ revision: 2, credential: { configured: true }, config: { label: 'Security alerts' } });
    expect(JSON.stringify(result)).not.toContain(webhookUrl);
    expect(JSON.stringify(mocks.auditCreate.mock.calls)).not.toContain(webhookUrl);
  });

  it('canonically replays reordered updates and conflicts on changed credentials', async () => {
    let record: { requestDigest: string; result: unknown; expiresAt: Date } | null = null;
    mocks.idempotencyFindFirst.mockImplementation(() => record);
    mocks.integrationFindUnique.mockResolvedValue(connection());
    mocks.integrationUpdateManyAndReturn.mockResolvedValue([{ ...connection(2), revision: 2, config: { label: 'Security' } }]);
    mocks.idempotencyCreate.mockImplementation(({ data }) => {
      record = { requestDigest: data.requestDigest, result: data.result, expiresAt: data.expiresAt };
      return record;
    });
    const webhookUrl = 'https://hooks.slack.com/services/T2/B2/canonical';
    const first = await updateProjectIntegration(context(), 'project-1', 'slack', {
      providerId: 'slack',
      label: 'Security',
      webhookUrl,
      replaceCredential: true,
      expectedRevision: 1,
      idempotencyKey: 'update-canonical-1',
    });
    const replay = await updateProjectIntegration(context(), 'project-1', 'slack', {
      providerId: 'slack',
      idempotencyKey: 'update-canonical-1',
      expectedRevision: 1,
      replaceCredential: true,
      webhookUrl,
      label: 'Security',
    });

    expect(replay).toEqual(first);
    expect(mocks.integrationUpdateManyAndReturn).toHaveBeenCalledTimes(1);
    await expect(
      updateProjectIntegration(context(), 'project-1', 'slack', {
        providerId: 'slack',
        idempotencyKey: 'update-canonical-1',
        expectedRevision: 1,
        replaceCredential: true,
        webhookUrl: 'https://hooks.slack.com/services/T2/B2/changed',
        label: 'Security',
      }),
    ).rejects.toMatchObject({ code: 'integration:idempotency_conflict' });
  });

  it('uses revision CAS and durable idempotency for activate and deactivate', async () => {
    let record: { requestDigest: string; result: unknown; expiresAt: Date } | null = null;
    mocks.idempotencyFindFirst.mockImplementation(() => record);
    mocks.integrationFindUnique.mockResolvedValue({ ...connection(), status: 'ACTIVE' });
    mocks.integrationUpdateManyAndReturn.mockResolvedValue([{ ...connection(2), status: 'INACTIVE', revision: 2 }]);
    mocks.idempotencyCreate.mockImplementation(({ data }) => {
      record = { requestDigest: data.requestDigest, result: data.result, expiresAt: data.expiresAt };
      return record;
    });
    const body = { expectedRevision: 1, idempotencyKey: 'status-key-2' };
    const first = await deactivateProjectIntegration(context(), 'project-1', 'slack', body);
    mocks.integrationFindUnique.mockResolvedValue(null);
    const replay = await deactivateProjectIntegration(context(), 'project-1', 'slack', {
      idempotencyKey: body.idempotencyKey,
      expectedRevision: body.expectedRevision,
    });

    expect(replay).toEqual(first);
    expect(mocks.integrationUpdateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'connection-1', revision: 1 } }));
    expect(mocks.integrationUpdateManyAndReturn).toHaveBeenCalledTimes(1);

    await expect(
      deactivateProjectIntegration(context(), 'project-1', 'slack', { idempotencyKey: body.idempotencyKey, expectedRevision: 2 }),
    ).rejects.toMatchObject({ code: 'integration:idempotency_conflict' });

    record = null;
    mocks.integrationFindUnique.mockResolvedValue(connection());
    mocks.integrationUpdateManyAndReturn.mockResolvedValue([]);
    await expect(
      activateProjectIntegration(context(), 'project-1', 'slack', { expectedRevision: 1, idempotencyKey: 'status-key-3' }),
    ).rejects.toMatchObject({ code: 'integration:revision_conflict' });
  });

  it('requires exact verify and delete API-key scopes', async () => {
    mocks.apiKeyFindFirst.mockResolvedValue({
      id: 'key-1',
      projectId: 'project-1',
      scopes: ['integrations:write'],
      project: { organizationId: 'org-1' },
    });
    await expect(verifyProjectIntegration(context(['integrations:write']), 'project-1', 'github', { providerId: 'github' })).rejects.toMatchObject({
      code: 'auth:insufficient_role',
    });
    await expect(
      deleteProjectIntegration(context(['integrations:write']), 'project-1', 'slack', { confirmationToken: 'x'.repeat(40) }),
    ).rejects.toMatchObject({ code: 'auth:insufficient_role' });
    expect(mocks.confirmationFindFirst).not.toHaveBeenCalled();
  });

  it('binds delete confirmations to principal, project, provider, revision, expiry, and single use', async () => {
    const row = connection();
    mocks.integrationFindUnique.mockResolvedValue(row);
    const valid = {
      id: 'confirmation-1',
      projectId: 'project-1',
      connectionId: row.id,
      providerId: 'slack',
      connectionRevision: 1,
      principalType: 'session',
      principalId: 'user-1',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      createdById: 'user-1',
    };
    mocks.confirmationFindFirst.mockResolvedValue({ ...valid, principalId: 'other-user' });
    await expect(deleteProjectIntegration(context(), 'project-1', 'slack', { confirmationToken: 'a'.repeat(40) })).rejects.toMatchObject({
      code: 'integration:confirmation_invalid',
    });
    mocks.confirmationFindFirst.mockResolvedValue({ ...valid, expiresAt: new Date(Date.now() - 1) });
    await expect(deleteProjectIntegration(context(), 'project-1', 'slack', { confirmationToken: 'b'.repeat(40) })).rejects.toMatchObject({
      code: 'integration:confirmation_expired',
    });

    let consumed = false;
    mocks.confirmationFindFirst.mockImplementation(() => (consumed ? { ...valid, consumedAt: new Date() } : valid));
    mocks.confirmationUpdateMany.mockImplementation(() => {
      consumed = true;
      return { count: 1 };
    });
    mocks.integrationDelete.mockResolvedValue(row);
    await expect(deleteProjectIntegration(context(), 'project-1', 'slack', { confirmationToken: 'c'.repeat(40) })).resolves.toEqual({
      providerId: 'slack',
      deleted: true,
    });
    await expect(deleteProjectIntegration(context(), 'project-1', 'slack', { confirmationToken: 'c'.repeat(40) })).rejects.toMatchObject({
      code: 'integration:confirmation_consumed',
    });
    expect(mocks.integrationDelete).toHaveBeenCalledTimes(1);
  });

  it('keeps consumed confirmation tombstones for the retention window and prunes expired challenges', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      mocks.integrationFindUnique.mockResolvedValue(connection());
      mocks.confirmationCreate.mockResolvedValue({ id: 'confirmation-retained' });

      await createIntegrationDeleteConfirmation(context(), 'project-1', 'slack', { expectedRevision: 1 });

      expect(mocks.confirmationDeleteMany).toHaveBeenCalledWith({
        where: {
          projectId: 'project-1',
          OR: [{ consumedAt: { lte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } }, { consumedAt: null, expiresAt: { lte: now } }],
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('atomically claims a delete confirmation so concurrent consumers receive a stable consumed error', async () => {
    const row = connection();
    const valid = {
      id: 'confirmation-race',
      projectId: 'project-1',
      connectionId: row.id,
      providerId: 'slack',
      connectionRevision: 1,
      principalType: 'session',
      principalId: 'user-1',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      createdById: 'user-1',
    };
    let claimed = false;
    mocks.confirmationFindFirst.mockResolvedValue(valid);
    mocks.integrationFindUnique.mockResolvedValue(row);
    mocks.confirmationUpdateMany.mockImplementation(async () => {
      if (claimed) return { count: 0 };
      claimed = true;
      return { count: 1 };
    });
    mocks.integrationDelete.mockResolvedValue(row);

    const results = await Promise.allSettled([
      deleteProjectIntegration(context(), 'project-1', 'slack', { confirmationToken: 'd'.repeat(40) }),
      deleteProjectIntegration(context(), 'project-1', 'slack', { confirmationToken: 'd'.repeat(40) }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((result) => result.status === 'rejected');
    expect(loser).toMatchObject({ status: 'rejected', reason: { code: 'integration:confirmation_consumed' } });
    expect(mocks.integrationDelete).toHaveBeenCalledTimes(1);
    expect(mocks.confirmationUpdateMany).toHaveBeenCalledWith({
      where: { id: valid.id, consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it('preserves GitHub stable errors and writes a provider-specific audit', async () => {
    mocks.gitConnectionFindUnique.mockResolvedValue(null);

    await expect(verifyProjectIntegration(context(), 'project-1', 'github', { providerId: 'github' })).rejects.toMatchObject({
      code: 'integration:credentials_required',
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ providerId: 'github', action: 'verify', result: 'failed' }) }),
    );
  });

  it('reclaims stale passive verification and canonically replays reordered input', async () => {
    const current = {
      ...connection(),
      providerId: 'discord',
      credentialEncrypted: encryptIntegrationSecret('https://discord.com/api/webhooks/1/token'),
    };
    const requestDigest = digestIntegrationValue(JSON.stringify(['integration-request', 1, 'verify', 'discord', 1, false]), 'request');
    let delivery = {
      id: 'delivery-stale-passive',
      connectionId: current.id,
      event: 'integration.test',
      eventVersion: 1,
      idempotencyDigest: 'digest',
      requestDigest,
      status: 'RUNNING',
      attempts: 1,
      responseStatus: null,
      errorCode: null,
      result: null,
      createdAt: new Date(now.getTime() - 180_000),
      startedAt: new Date(now.getTime() - 120_000),
      completedAt: null,
    };
    mocks.integrationFindUnique.mockResolvedValue(current);
    mocks.deliveryFindFirst.mockImplementation(() => delivery);
    mocks.deliveryUpdateMany.mockImplementation(({ data }) => {
      delivery = {
        ...delivery,
        ...data,
        attempts: data.attempts ? delivery.attempts + 1 : delivery.attempts,
      };
      return { count: 1 };
    });
    mocks.deliveryUpdate.mockImplementation(({ data }) => {
      delivery = { ...delivery, ...data };
      return delivery;
    });
    mocks.integrationUpdateManyAndReturn.mockResolvedValue([{ ...current, revision: 2, lastVerificationStatus: 'HEALTHY' }]);
    mocks.verifyWebhookProvider.mockResolvedValue({ responseStatus: 200 });
    const first = await verifyProjectIntegration(context(), 'project-1', 'discord', {
      idempotencyKey: 'aaaaaaaa',
      providerId: 'discord',
      expectedRevision: 1,
    });
    const replay = await verifyProjectIntegration(context(), 'project-1', 'discord', {
      expectedRevision: 1,
      providerId: 'discord',
      idempotencyKey: 'aaaaaaaa',
    });

    expect(replay).toEqual(first);
    expect(mocks.verifyWebhookProvider).toHaveBeenCalledTimes(1);
    expect(mocks.deliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'delivery-stale-passive', status: 'RUNNING' }),
        data: expect.objectContaining({ status: 'RUNNING', startedAt: expect.any(Date) }),
      }),
    );
    await expect(
      verifyProjectIntegration(context(), 'project-1', 'discord', {
        providerId: 'discord',
        idempotencyKey: 'aaaaaaaa',
        expectedRevision: 2,
      }),
    ).rejects.toMatchObject({ code: 'integration:idempotency_conflict' });
  });

  it('finalizes stale provider-visible verification without resending an unknown side effect', async () => {
    const current = {
      ...connection(),
      credentialEncrypted: encryptIntegrationSecret('https://hooks.slack.com/services/T1/B1/secret'),
    };
    const requestDigest = digestIntegrationValue(JSON.stringify(['integration-request', 1, 'verify', 'slack', 1, true]), 'request');
    let delivery = {
      id: 'delivery-stale-visible',
      connectionId: current.id,
      event: 'integration.test',
      eventVersion: 1,
      idempotencyDigest: 'digest',
      requestDigest,
      status: 'RUNNING',
      attempts: 1,
      responseStatus: null,
      errorCode: null,
      result: null,
      createdAt: new Date(now.getTime() - 180_000),
      startedAt: new Date(now.getTime() - 120_000),
      completedAt: null,
    };
    mocks.integrationFindUnique.mockResolvedValue(current);
    mocks.deliveryFindFirst.mockImplementation(() => delivery);
    mocks.deliveryUpdateMany.mockImplementation(({ data }) => {
      delivery = { ...delivery, ...data };
      return { count: 1 };
    });
    const body = {
      providerId: 'slack' as const,
      expectedRevision: 1,
      idempotencyKey: 'verify-visible-1',
      confirmExternalSideEffect: true,
    };

    await expect(verifyProjectIntegration(context(), 'project-1', 'slack', body)).rejects.toMatchObject({
      code: 'integration:provider_unavailable',
    });
    await expect(verifyProjectIntegration(context(), 'project-1', 'slack', body)).rejects.toMatchObject({
      code: 'integration:provider_unavailable',
    });
    expect(mocks.verifyWebhookProvider).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerId: 'slack',
          action: 'verify',
          result: 'failed',
          code: 'integration:provider_unavailable',
          metadata: { externalSideEffect: true, recovery: 'unknown_delivery' },
        }),
      }),
    );
  });

  it('records and replays revision conflicts when verification races an update', async () => {
    const current = {
      ...connection(),
      providerId: 'discord',
      credentialEncrypted: encryptIntegrationSecret('https://discord.com/api/webhooks/1/token'),
    };
    let delivery: { status: string; errorCode: string | null; requestDigest: string } | null = null;
    mocks.integrationFindUnique.mockResolvedValue(current);
    mocks.deliveryFindFirst.mockImplementation(() => delivery);
    mocks.deliveryCreate.mockResolvedValue({ id: 'delivery-1' });
    mocks.deliveryUpdate.mockImplementation(({ data }) => {
      if (data.status === 'FAILED') delivery = { status: 'FAILED', errorCode: data.errorCode, requestDigest: expect.any(String) };
      return {};
    });
    mocks.integrationUpdateManyAndReturn.mockResolvedValue([]);
    mocks.verifyWebhookProvider.mockResolvedValue({ responseStatus: 200 });
    const body = { providerId: 'discord' as const, expectedRevision: 1, idempotencyKey: 'verify-key-1' };

    await expect(verifyProjectIntegration(context(), 'project-1', 'discord', body)).rejects.toMatchObject({
      code: 'integration:revision_conflict',
    });
    const terminalUpdate = mocks.deliveryUpdate.mock.calls.find((call) => call[0].data.status === 'FAILED');
    delivery = { ...terminalUpdate?.[0].data, requestDigest: mocks.deliveryCreate.mock.calls[0]?.[0].data.requestDigest };
    await expect(verifyProjectIntegration(context(), 'project-1', 'discord', body)).rejects.toMatchObject({
      code: 'integration:revision_conflict',
    });
    expect(mocks.verifyWebhookProvider).toHaveBeenCalledTimes(1);
  });

  it('retains provider identity in audit history after deleting the connection', async () => {
    const row = connection();
    const auditRows: Array<{ connectionId: string | null; providerId: string; action: string }> = [];
    mocks.integrationFindUnique.mockResolvedValue(row);
    mocks.confirmationCreate.mockImplementation(({ data }) => {
      mocks.confirmationFindFirst.mockResolvedValue({ id: 'confirmation-1', ...data, consumedAt: null });
      return data;
    });
    mocks.auditCreate.mockImplementation(({ data }) => {
      auditRows.push({ connectionId: data.connectionId ?? null, providerId: data.providerId, action: data.action });
      return data;
    });
    mocks.integrationDelete.mockImplementation(() => {
      for (const audit of auditRows) audit.connectionId = null;
      return row;
    });
    const confirmation = await createIntegrationDeleteConfirmation(context(), 'project-1', 'slack', { expectedRevision: 1 });
    await deleteProjectIntegration(context(), 'project-1', 'slack', { confirmationToken: confirmation.confirmationToken });

    expect(auditRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'slack', action: 'create_delete_confirmation' }),
        expect.objectContaining({ providerId: 'slack', action: 'delete', connectionId: null }),
      ]),
    );
  });
});

/** A fresh catalog read for project-1, whose site config is `config`. */
const listFor = async (config: unknown) => {
  mocks.projectFindUnique.mockResolvedValue({ id: 'project-1', organizationId: 'org-1', createdAt: now, config, gitSettings: { settings: {} } });
  return listProjectIntegrations(context(), 'project-1');
};
const resetCatalogMocks = () => {
  vi.clearAllMocks();
  mocks.assertProjectAccess.mockResolvedValue({ organizationId: 'org-1', role: 'admin' });
  mocks.gitConnectionFindUnique.mockResolvedValue(null);
  mocks.integrationFindMany.mockResolvedValue([]);
};
const mutableEnv = env as { OPENROUTER_API_KEY?: string };

describe('the server-managed OpenRouter entry', () => {
  beforeEach(resetCatalogMocks);
  afterEach(() => {
    mutableEnv.OPENROUTER_API_KEY = undefined;
    runtime.answersEnabled = false;
  });

  // Matches Smart AI's badge: "Active" only while this site's readers get answers from it.
  it.each([
    { operatorKey: false, siteAiOn: false, status: null },
    { operatorKey: false, siteAiOn: true, status: null },
    { operatorKey: true, siteAiOn: false, status: 'inactive' },
    { operatorKey: true, siteAiOn: true, status: 'active' },
  ])('operator key: $operatorKey, site AI on: $siteAiOn → $status', async ({ operatorKey, siteAiOn, status }) => {
    runtime.answersEnabled = true;
    mutableEnv.OPENROUTER_API_KEY = operatorKey ? 'operator-secret-key' : undefined;

    const catalog = await listFor({ search: { aiAnswers: siteAiOn } });
    const openrouter = catalog.find(({ id }) => id === 'openrouter');

    if (status === null) expect(openrouter?.connection).toBeNull();
    else expect(openrouter?.connection).toMatchObject({ ownership: 'instance', status });
    expect(JSON.stringify(catalog)).not.toContain('operator-secret-key');
  });

  it.each([
    { name: 'the site uses its own OpenAI key', search: { aiProvider: 'openai', aiAnswers: true }, answersEnabled: true },
    { name: 'the site turned AI off', search: { aiProvider: 'disabled', aiAnswers: false }, answersEnabled: true },
    { name: 'the server does not allow answers', search: { aiProvider: 'instance', aiAnswers: true }, answersEnabled: false },
  ])('is inactive when $name', async ({ search, answersEnabled }) => {
    runtime.answersEnabled = answersEnabled;
    mutableEnv.OPENROUTER_API_KEY = 'operator-secret-key';

    const openrouter = (await listFor({ search })).find(({ id }) => id === 'openrouter');

    expect(openrouter?.connection?.status).toBe('inactive');
  });
});

describe('Slack, Discord and Zapier while delivery is coming soon', () => {
  beforeEach(() => {
    resetCatalogMocks();
    runtime.webhooksLive = false;
  });
  afterEach(() => {
    runtime.webhooksLive = true;
  });

  it('ships exactly these three as coming soon', async () => {
    const actual = await vi.importActual<typeof import('@nibleaf/shared/integrations')>('@nibleaf/shared/integrations');
    expect(actual.INTEGRATION_CATALOG.filter((manifest) => manifest.comingSoon).map(({ id }) => id)).toEqual(['slack', 'discord', 'zapier']);
  });

  it('lists them as coming soon, keeping a stored connection visible', async () => {
    mocks.integrationFindMany.mockResolvedValue([connection()]);

    const catalog = await listFor(null);

    for (const id of ['slack', 'discord', 'zapier']) expect(catalog.find((entry) => entry.id === id)?.availability).toBe('coming_soon');
    expect(catalog.find(({ id }) => id === 'slack')?.connection).toMatchObject({ providerId: 'slack' });
    expect(catalog.find(({ id }) => id === 'discord')?.connection).toBeNull();
  });

  it('refuses to connect, edit, activate, deactivate or test them, before touching anything', async () => {
    const refused = { code: 'integration:provider_unavailable' };
    const revision = { expectedRevision: 1, idempotencyKey: 'key-1' };

    await expect(
      createProjectIntegration(context(), 'project-1', {
        providerId: 'slack',
        webhookUrl: 'https://hooks.slack.com/services/T1/B1/secret',
        idempotencyKey: 'key-1',
      }),
    ).rejects.toMatchObject(refused);
    await expect(
      updateProjectIntegration(context(), 'project-1', 'discord', { providerId: 'discord', label: 'Team', ...revision }),
    ).rejects.toMatchObject(refused);
    await expect(activateProjectIntegration(context(), 'project-1', 'zapier', revision)).rejects.toMatchObject(refused);
    await expect(deactivateProjectIntegration(context(), 'project-1', 'slack', revision)).rejects.toMatchObject(refused);
    await expect(
      verifyProjectIntegration(context(), 'project-1', 'slack', { providerId: 'slack', ...revision, confirmExternalSideEffect: true }),
    ).rejects.toMatchObject(refused);

    expect(mocks.idempotencyFindFirst).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.verifyWebhookProvider).not.toHaveBeenCalled();
  });

  it('still removes a stored connection', async () => {
    const row = connection();
    mocks.integrationFindUnique.mockResolvedValue(row);
    mocks.integrationDelete.mockResolvedValue(row);
    mocks.transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback({
        integrationAuditEvent: { create: mocks.auditCreate },
        integrationConfirmation: {
          create: mocks.confirmationCreate,
          deleteMany: mocks.confirmationDeleteMany,
          findFirst: mocks.confirmationFindFirst,
          updateMany: mocks.confirmationUpdateMany,
        },
        projectIntegration: { delete: mocks.integrationDelete, findUnique: mocks.integrationFindUnique },
      }),
    );
    mocks.confirmationDeleteMany.mockResolvedValue({ count: 0 });
    mocks.confirmationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.confirmationCreate.mockImplementation(({ data }) => {
      mocks.confirmationFindFirst.mockResolvedValue({ id: 'confirmation-1', ...data, consumedAt: null });
      return data;
    });

    const confirmation = await createIntegrationDeleteConfirmation(context(), 'project-1', 'slack', { expectedRevision: 1 });
    await deleteProjectIntegration(context(), 'project-1', 'slack', { confirmationToken: confirmation.confirmationToken });

    expect(mocks.integrationDelete).toHaveBeenCalledTimes(1);
  });
});

describe("a site's own stored AI keys", () => {
  const embedding = 'openai/text-embedding-3-large';
  const storedKey = (providerId: 'openai' | 'openrouter', overrides: Record<string, unknown> = {}) => ({
    ...connection(),
    id: `ai-${providerId}`,
    providerId,
    config: { answerModel: 'openai/gpt-6-luna', embeddingModel: embedding },
    // A real envelope, so "readable with the current keyring" is checked for real.
    credentialEncrypted: encryptIntegrationSecret(
      JSON.stringify({ kind: 'workspace-ai', projectId: 'project-1', providerId, apiKey: `site-${providerId}-secret` }),
    ),
    lastVerificationStatus: 'HEALTHY',
    lastVerifiedAt: now,
    ...overrides,
  });
  const statuses = async (stored: ReturnType<typeof storedKey>[], search: Record<string, unknown>) => {
    mocks.integrationFindMany.mockResolvedValue(stored);
    const catalog = await listFor({ search });
    expect(JSON.stringify(catalog)).not.toMatch(/site-(openai|openrouter)-secret|operator-secret-key/);
    return Object.fromEntries(
      (['openai', 'openrouter'] as const).map((id) => [id, catalog.find((entry) => entry.id === id)?.connection?.status ?? null]),
    );
  };

  beforeEach(() => {
    resetCatalogMocks();
    runtime.answersEnabled = true;
    runtime.embeddingModel = embedding;
    mutableEnv.OPENROUTER_API_KEY = 'operator-secret-key';
  });
  afterEach(() => {
    runtime.answersEnabled = false;
    runtime.embeddingModel = 'embedding';
    mutableEnv.OPENROUTER_API_KEY = undefined;
  });

  // One rule with the operator entry: "active" only while it is what answers readers.
  it.each([
    {
      name: 'own OpenAI key, AI on',
      stored: ['openai'],
      search: { aiProvider: 'openai', aiAnswers: true },
      openai: 'active',
      openrouter: 'inactive',
    },
    {
      name: 'own OpenAI key, AI off',
      stored: ['openai'],
      search: { aiProvider: 'openai', aiAnswers: false },
      openai: 'inactive',
      openrouter: 'inactive',
    },
    {
      name: 'own OpenRouter key, AI on',
      stored: ['openrouter'],
      search: { aiProvider: 'openrouter', aiAnswers: true },
      openai: null,
      openrouter: 'active',
    },
    {
      name: 'own OpenRouter key, AI off',
      stored: ['openrouter'],
      search: { aiProvider: 'openrouter', aiAnswers: false },
      openai: null,
      openrouter: 'inactive',
    },
    {
      name: 'own OpenAI key saved, server AI selected and on',
      stored: ['openai'],
      search: { aiProvider: 'instance', aiAnswers: true },
      openai: 'inactive',
      openrouter: 'active',
    },
    {
      name: 'own OpenRouter key saved, server AI selected and on',
      stored: ['openrouter'],
      search: { aiAnswers: true },
      openai: null,
      openrouter: 'inactive',
    },
    {
      name: 'both keys saved, OpenAI selected and on',
      stored: ['openai', 'openrouter'],
      search: { aiProvider: 'openai', aiAnswers: true },
      openai: 'active',
      openrouter: 'inactive',
    },
    {
      name: 'own key saved, AI turned off',
      stored: ['openai'],
      search: { aiProvider: 'disabled', aiAnswers: false },
      openai: 'inactive',
      openrouter: 'inactive',
    },
  ] as const)('$name → OpenAI $openai, OpenRouter $openrouter', async ({ stored, search, openai, openrouter }) => {
    expect(
      await statuses(
        stored.map((id) => storedKey(id)),
        search,
      ),
    ).toEqual({ openai, openrouter });
  });

  it.each([
    { name: 'it failed its last check', overrides: { lastVerificationStatus: 'UNHEALTHY' } },
    { name: 'it was built for another embedding model', overrides: { config: { answerModel: 'm', embeddingModel: 'openai/old-embedding' } } },
    { name: 'it is switched off in the database', overrides: { status: 'INACTIVE' } },
    { name: 'its stored key cannot be read with the current keyring', overrides: { credentialEncrypted: 'not-an-envelope' } },
    {
      name: 'its stored key belongs to another site',
      overrides: {
        credentialEncrypted: encryptIntegrationSecret(
          JSON.stringify({ kind: 'workspace-ai', projectId: 'project-2', providerId: 'openai', apiKey: 'other-site-secret' }),
        ),
      },
    },
  ])('needs attention when selected and on but $name', async ({ overrides }) => {
    const result = await statuses([storedKey('openai', overrides)], { aiProvider: 'openai', aiAnswers: true });
    expect(result.openai).toBe('error');
  });

  it('keeps a key marked broken as needing attention even when not in use', async () => {
    const result = await statuses([storedKey('openrouter', { status: 'ERROR' })], { aiProvider: 'instance', aiAnswers: true });
    expect(result.openrouter).toBe('error');
  });
});
