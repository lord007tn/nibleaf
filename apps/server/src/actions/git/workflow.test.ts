import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(),
    branch: { findFirst: vi.fn() },
    gitAuditEvent: { create: vi.fn() },
    gitConflict: { createMany: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    gitConnection: { update: vi.fn() },
    gitFileState: { deleteMany: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    gitPreview: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    gitPullRequest: { upsert: vi.fn() },
    gitSyncOperation: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    gitWebhookDelivery: { updateMany: vi.fn() },
    language: { findFirst: vi.fn() },
    page: { deleteMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    project: { findUnique: vi.fn() },
  };
  const provider = {
    createBranch: vi.fn(),
    createCommit: vi.fn(),
    getBranchSha: vi.fn(),
    getPullRequest: vi.fn(),
    listMarkdownFiles: vi.fn(),
    updateBranch: vi.fn(),
    upsertDraftPullRequest: vi.fn(),
  };
  return {
    createJob: vi.fn(),
    getDefaultBranch: vi.fn(),
    getDefaultLanguage: vi.fn(),
    prisma,
    provider,
  };
});

vi.mock('@nibleaf/bullmq', () => ({
  createJob: mocks.createJob,
  QueueNames: { GIT: 'git' },
  QUEUE_CONFIGS: { git: { operationClaimTimeout: 12 * 60 * 1000 } },
}));
vi.mock('@nibleaf/database', () => ({ prisma: mocks.prisma }));
vi.mock('@nibleaf/shared', () => ({ slugify: (value: string) => value.toLowerCase() }));
vi.mock('@nibleaf/shared/site', () => ({ buildSnapshot: vi.fn() }));
vi.mock('../branches', () => ({ getDefaultBranch: mocks.getDefaultBranch }));
vi.mock('../importers/content', () => ({
  deriveTitle: vi.fn(),
  humanize: (value: string) => value,
  parseFrontmatter: vi.fn(),
}));
vi.mock('../importers/persistence', () => ({ ensureGroupPage: vi.fn(), upsertLeafPage: vi.fn() }));
vi.mock('../languages', () => ({ getDefaultLanguage: mocks.getDefaultLanguage }));
vi.mock('./crypto', () => ({
  decryptGitSecret: () => 'token',
  encryptGitSecret: vi.fn(),
  gitCredentialFingerprint: vi.fn(),
}));
vi.mock('./github', () => ({
  GitHubProvider: class GitHubProviderMock {
    createBranch = mocks.provider.createBranch;
    createCommit = mocks.provider.createCommit;
    getBranchSha = mocks.provider.getBranchSha;
    getPullRequest = mocks.provider.getPullRequest;
    listMarkdownFiles = mocks.provider.listMarkdownFiles;
    updateBranch = mocks.provider.updateBranch;
    upsertDraftPullRequest = mocks.provider.upsertDraftPullRequest;
  },
}));
vi.mock('./reconcile', () => ({ conflictSnapshotMatches: vi.fn(), reconcileFile: vi.fn() }));

import { processGitOperation } from './workflow';

const connection = {
  id: 'connection-1',
  projectId: 'project-1',
  provider: 'github',
  credentialEncrypted: 'encrypted-token',
  repository: 'acme/docs',
  baseBranch: 'main',
  headBranch: 'nibleaf/docs',
  contentPath: '',
  importBranchId: null,
  importLanguageId: null,
  remoteHeadSha: null,
};

const operation = (status = 'QUEUED') => ({
  id: 'operation-1',
  connectionId: connection.id,
  connection,
  conflicts: [],
  kind: 'PULL',
  status,
  idempotencyKey: 'manual-sync-1',
  requestHash: 'hash',
  requestedById: null,
  baseBranch: connection.baseBranch,
  headBranch: connection.headBranch,
  commitMessage: null,
  authorName: null,
  authorEmail: null,
  request: {},
  changedFiles: null,
  remoteSha: null,
  pullRequestNo: null,
  pullRequestUrl: null,
  error: null,
  createdAt: new Date('2026-08-17T00:00:00.000Z'),
  startedAt: null,
  completedAt: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (input: unknown, _options?: unknown) => {
    if (typeof input === 'function') return input(mocks.prisma);
    return Promise.all(input as Promise<unknown>[]);
  });
  mocks.prisma.gitSyncOperation.findUnique.mockResolvedValue(operation());
  mocks.prisma.gitSyncOperation.findFirst.mockResolvedValue(null);
  mocks.prisma.gitSyncOperation.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.gitSyncOperation.update.mockResolvedValue({});
  mocks.prisma.gitConnection.update.mockResolvedValue({});
  mocks.prisma.gitFileState.findMany.mockResolvedValue([]);
  mocks.prisma.gitConflict.findMany.mockResolvedValue([]);
  mocks.prisma.gitAuditEvent.create.mockResolvedValue({});
  mocks.prisma.page.findMany.mockResolvedValue([]);
  mocks.getDefaultBranch.mockResolvedValue({ id: 'branch-1' });
  mocks.getDefaultLanguage.mockResolvedValue({ id: 'language-1' });
  mocks.provider.getBranchSha.mockImplementation(async (_repository: string, branch: string) => (branch === 'main' ? 'base-sha' : 'head-sha'));
  mocks.provider.listMarkdownFiles.mockResolvedValue([]);
});

describe('processGitOperation', () => {
  it('claims and completes a conflict-free no-op transactionally', async () => {
    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();

    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(mocks.prisma.gitSyncOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'operation-1', status: 'QUEUED' }),
        data: expect.objectContaining({ status: 'RUNNING', error: null }),
      }),
    );
    expect(mocks.provider.listMarkdownFiles).toHaveBeenCalledOnce();
    expect(mocks.prisma.gitSyncOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'operation-1' }, data: expect.objectContaining({ status: 'SUCCEEDED', remoteSha: 'head-sha' }) }),
    );
  });

  it('rejects a concurrent operation on the same connection without reconciling or marking it failed', async () => {
    mocks.prisma.gitSyncOperation.findFirst.mockResolvedValue({ id: 'operation-in-flight', startedAt: new Date() });

    await expect(processGitOperation('operation-1')).rejects.toThrow(/already running for connection/);

    expect(mocks.provider.getBranchSha).not.toHaveBeenCalled();
    expect(mocks.prisma.gitSyncOperation.update).not.toHaveBeenCalled();
    expect(mocks.prisma.gitConnection.update).not.toHaveBeenCalled();
  });

  it('turns a serializable claim race into a retryable busy result', async () => {
    mocks.prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' });

    await expect(processGitOperation('operation-1')).rejects.toThrow(/already running/);

    expect(mocks.provider.getBranchSha).not.toHaveBeenCalled();
    expect(mocks.prisma.gitSyncOperation.update).not.toHaveBeenCalled();
  });

  it('recovers an abandoned connection claim before processing the queued operation', async () => {
    mocks.prisma.gitSyncOperation.findFirst.mockResolvedValue({
      id: 'abandoned-operation',
      startedAt: new Date(Date.now() - 13 * 60 * 1000),
    });

    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();

    expect(mocks.prisma.gitSyncOperation.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ id: 'abandoned-operation', status: 'RUNNING' }),
        data: expect.objectContaining({ status: 'FAILED', error: expect.stringContaining('interrupted') }),
      }),
    );
    expect(mocks.prisma.gitSyncOperation.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ id: 'operation-1' }), data: expect.objectContaining({ status: 'RUNNING' }) }),
    );
  });

  it('returns idempotently when the operation already succeeded', async () => {
    mocks.prisma.gitSyncOperation.findUnique.mockResolvedValue(operation('SUCCEEDED'));

    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();

    expect(mocks.prisma.gitSyncOperation.updateMany).not.toHaveBeenCalled();
    expect(mocks.provider.getBranchSha).not.toHaveBeenCalled();
  });

  it('records provider failures after a successful claim so BullMQ can retry safely', async () => {
    const providerError = new Error('GitHub API 503: unavailable');
    mocks.provider.getBranchSha.mockRejectedValueOnce(providerError);

    await expect(processGitOperation('operation-1')).rejects.toBe(providerError);

    expect(mocks.prisma.gitSyncOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'operation-1' }, data: expect.objectContaining({ status: 'FAILED', error: providerError.message }) }),
    );
    expect(mocks.prisma.gitConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: connection.id }, data: expect.objectContaining({ lastSyncStatus: 'FAILED' }) }),
    );
  });
});
