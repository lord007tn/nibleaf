import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real Git crypto runs in this file, so it needs an encryption key before
// `@/env` loads. 32 zero bytes is obviously not a real key.
const mocks = vi.hoisted(() => {
  process.env.GIT_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
  const provider = {
    getBranchSha: vi.fn(),
    listMarkdownFiles: vi.fn(),
    listThemeRepositoryFiles: vi.fn(),
    verifyWriteAccess: vi.fn(),
  };
  return {
    getCurrentSnapshot: vi.fn(),
    getDefaultBranch: vi.fn(),
    getDefaultLanguage: vi.fn(),
    prisma: {
      $transaction: vi.fn(),
      branch: { findFirst: vi.fn() },
      gitAuditEvent: { create: vi.fn() },
      gitConnection: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
      gitFileState: { deleteMany: vi.fn(), upsert: vi.fn() },
      language: { findFirst: vi.fn() },
      page: { findMany: vi.fn() },
    },
    provider,
    providerTokens: [] as string[],
  };
});

vi.mock('@nibleaf/bullmq', () => ({
  createJob: vi.fn(),
  QueueNames: { GIT: 'git' },
  QUEUE_CONFIGS: { git: { operationClaimTimeout: 12 * 60 * 1000 } },
}));
vi.mock('@nibleaf/database', () => ({ prisma: mocks.prisma }));
vi.mock('../branches', () => ({ getDefaultBranch: mocks.getDefaultBranch }));
vi.mock('../deployments', () => ({ getCurrentSnapshot: mocks.getCurrentSnapshot }));
vi.mock('../languages', () => ({ getDefaultLanguage: mocks.getDefaultLanguage }));
vi.mock('./github', () => ({
  GitHubProvider: class GitHubProviderMock {
    getBranchSha = mocks.provider.getBranchSha;
    listMarkdownFiles = mocks.provider.listMarkdownFiles;
    listThemeRepositoryFiles = mocks.provider.listThemeRepositoryFiles;
    verifyWriteAccess = mocks.provider.verifyWriteAccess;
    constructor(token: string) {
      mocks.providerTokens.push(token);
    }
  },
}));

import { gitConnectionBody } from '@nibleaf/validators';
import {
  type GitWorkflowConnectionValues,
  gitWorkflowConnectionPayload,
  gitWorkflowConnectionValues,
  sentGitWorkflowConnectionValues,
} from '../../../../app/src/features/site-git/model/git-workflow-connection';
import { decryptGitSecret, encryptGitSecret, gitCredentialFingerprint } from './crypto';
import { connectGitHub } from './workflow';

const STORED_TOKEN = 'test-token-0001';
const NEW_TOKEN = 'test-token-0002';
const STORED_WEBHOOK = 'test-webhook-0001';

const snapshot = {
  project: {
    id: 'project-1',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    config: null,
    languages: [{ code: 'en', label: 'English', direction: 'LTR' as const, isDefault: true, config: null }],
    versions: [{ id: 'branch-1', name: 'Main', slug: 'main', isDefault: true }],
  },
  pages: [],
  generatedAt: '2026-08-23T00:00:00.000Z',
};

const remoteFile = { path: 'guides/intro.md', sha: 'blob-1', content: '# Intro\n' };

const storedConnection = () => ({
  id: 'connection-1',
  projectId: 'project-1',
  provider: 'github',
  repository: 'acme/docs',
  baseBranch: 'main',
  headBranch: 'nibleaf/docs',
  contentPath: '',
  importBranchId: null as string | null,
  importLanguageId: null as string | null,
  credentialEncrypted: encryptGitSecret(STORED_TOKEN),
  credentialFingerprint: gitCredentialFingerprint(STORED_TOKEN),
  webhookSecretEncrypted: encryptGitSecret(STORED_WEBHOOK),
  remoteBaseSha: 'old-base-sha',
  remoteHeadSha: 'old-head-sha',
  createdById: 'user-0',
});

/** Mocked Prisma rows: update merges into the stored row, upsert creates. */
const installConnection = (row: ReturnType<typeof storedConnection> | null) => {
  mocks.prisma.gitConnection.findUnique.mockResolvedValue(row);
  mocks.prisma.gitConnection.update.mockImplementation(async ({ data }: { data: object }) => ({ ...row, ...data }));
  mocks.prisma.gitConnection.upsert.mockImplementation(async ({ create }: { create: object }) => ({ id: 'connection-new', ...create }));
};

/** The first argument a mocked Prisma method received; fails the test when it was never called. */
const firstInput = <T>(method: { mock: { calls: unknown[][] } }): T => {
  const [input] = method.mock.calls[0] ?? [];
  expect(input).toBeDefined();
  return input as T;
};
const savedData = () => firstInput<{ data: Record<string, unknown> }>(mocks.prisma.gitConnection.update).data;
const fileStateWrites = () =>
  mocks.prisma.gitFileState.upsert.mock.calls.map(([input]) => input as { create: Record<string, unknown>; update: object });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.providerTokens.length = 0;
  mocks.prisma.$transaction.mockImplementation(async (writes: Promise<unknown>[]) => Promise.all(writes));
  mocks.prisma.gitFileState.upsert.mockResolvedValue({});
  mocks.prisma.gitFileState.deleteMany.mockResolvedValue({ count: 1 });
  mocks.prisma.gitAuditEvent.create.mockResolvedValue({});
  mocks.prisma.page.findMany.mockResolvedValue([]);
  mocks.getCurrentSnapshot.mockResolvedValue(snapshot);
  mocks.getDefaultBranch.mockResolvedValue({ id: 'branch-1' });
  mocks.getDefaultLanguage.mockResolvedValue({ id: 'language-1' });
  mocks.prisma.branch.findFirst.mockResolvedValue({ id: 'branch-2' });
  mocks.prisma.language.findFirst.mockResolvedValue({ id: 'language-2' });
  mocks.provider.verifyWriteAccess.mockResolvedValue(undefined);
  mocks.provider.getBranchSha.mockImplementation(async (_repository: string, branch: string) => (branch === 'main' ? 'base-sha' : 'head-sha'));
  mocks.provider.listThemeRepositoryFiles.mockResolvedValue([remoteFile]);
});

describe('connectGitHub with the real Git crypto', () => {
  it('saves an existing connection without a token, keeping its credential and webhook secret', async () => {
    const stored = storedConnection();
    installConnection(stored);

    const result = await connectGitHub('project-1', 'user-1', {
      repository: ' https://github.com/acme/docs.git ',
      baseBranch: 'refs/heads/main',
      headBranch: ' nibleaf/docs ',
      contentPath: 'docs/',
    });

    expect(mocks.providerTokens).toEqual([STORED_TOKEN]);
    expect(mocks.prisma.gitConnection.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.gitConnection.update).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      data: {
        repository: 'acme/docs',
        baseBranch: 'main',
        headBranch: 'nibleaf/docs',
        contentPath: 'docs',
        importBranchId: null,
        importLanguageId: null,
        remoteBaseSha: 'base-sha',
        remoteHeadSha: 'head-sha',
      },
    });
    expect(result.webhookSecret).toBeNull();
    expect(result.connection).toMatchObject({ credentialConfigured: true, webhookConfigured: true, contentPath: 'docs' });
    expect(result.connection).not.toHaveProperty('credentialEncrypted');
    expect(result.connection).not.toHaveProperty('webhookSecretEncrypted');
    expect(mocks.prisma.gitAuditEvent.create.mock.calls[0]?.[0]).toMatchObject({
      data: { action: 'connection.updated', metadata: { credentialRotated: false } },
    });
  });

  it('saves an existing connection with a new token, re-encrypting the credential and keeping the webhook secret', async () => {
    installConnection(storedConnection());

    const result = await connectGitHub('project-1', 'user-1', {
      repository: 'acme/docs',
      baseBranch: 'main',
      headBranch: 'nibleaf/docs',
      token: NEW_TOKEN,
    });

    expect(mocks.providerTokens).toEqual([NEW_TOKEN]);
    const data = savedData();
    expect(decryptGitSecret(data.credentialEncrypted as string)).toBe(NEW_TOKEN);
    expect(data.credentialFingerprint).toBe(gitCredentialFingerprint(NEW_TOKEN));
    expect(data).not.toHaveProperty('webhookSecretEncrypted');
    expect(JSON.stringify(data)).not.toContain(NEW_TOKEN);
    expect(result.webhookSecret).toBeNull();
    expect(JSON.stringify(result)).not.toContain(NEW_TOKEN);
    expect(mocks.prisma.gitAuditEvent.create.mock.calls[0]?.[0]).toMatchObject({
      data: { action: 'connection.updated', metadata: { credentialRotated: true } },
    });
  });

  it('creates a new connection from a token with a generated webhook secret', async () => {
    installConnection(null);

    const result = await connectGitHub('project-1', 'user-1', {
      repository: 'acme/docs',
      baseBranch: 'main',
      headBranch: 'nibleaf/docs',
      token: NEW_TOKEN,
    });

    expect(mocks.prisma.gitConnection.update).not.toHaveBeenCalled();
    const { create } = firstInput<{ create: Record<string, unknown> }>(mocks.prisma.gitConnection.upsert);
    expect(create).toMatchObject({ projectId: 'project-1', provider: 'github', repository: 'acme/docs', createdById: 'user-1' });
    expect(decryptGitSecret(create.credentialEncrypted as string)).toBe(NEW_TOKEN);
    expect(create.credentialFingerprint).toBe(gitCredentialFingerprint(NEW_TOKEN));
    expect(result.webhookSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(decryptGitSecret(create.webhookSecretEncrypted as string)).toBe(result.webhookSecret);
    expect(mocks.prisma.gitAuditEvent.create.mock.calls[0]?.[0]).toMatchObject({
      data: { action: 'connection.created', metadata: { credentialRotated: false } },
    });
  });

  it('refuses a new connection without a token before contacting GitHub or writing', async () => {
    installConnection(null);

    await expect(connectGitHub('project-1', 'user-1', { repository: 'acme/docs', baseBranch: 'main', headBranch: 'nibleaf/docs' })).rejects.toThrow(
      'A fine-grained GitHub token is required for the first connection.',
    );

    expect(mocks.providerTokens).toEqual([]);
    expect(mocks.prisma.gitConnection.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.gitConnection.update).not.toHaveBeenCalled();
  });

  it('keeps the file-state baseline when the topology is unchanged', async () => {
    installConnection(storedConnection());

    await connectGitHub('project-1', 'user-1', { repository: 'acme/docs', baseBranch: 'main', headBranch: 'nibleaf/docs' });

    expect(mocks.prisma.gitFileState.deleteMany).not.toHaveBeenCalled();
    expect(fileStateWrites()).toEqual([
      expect.objectContaining({
        create: expect.objectContaining({ connectionId: 'connection-1', path: remoteFile.path, branchId: 'branch-1', languageId: 'language-1' }),
        update: {},
      }),
    ]);
  });

  it('rebuilds the file-state baseline on the new import target when the topology changes', async () => {
    installConnection(storedConnection());

    await connectGitHub('project-1', 'user-1', {
      repository: 'acme/docs',
      baseBranch: 'main',
      headBranch: 'nibleaf/docs',
      importBranchId: 'branch-2',
      importLanguageId: 'language-2',
    });

    expect(savedData()).toMatchObject({ importBranchId: 'branch-2', importLanguageId: 'language-2' });
    expect(mocks.prisma.gitFileState.deleteMany).toHaveBeenCalledWith({ where: { connectionId: 'connection-1' } });
    expect(mocks.prisma.branch.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'branch-2', projectId: 'project-1' } }));
    expect(fileStateWrites()).toEqual([
      expect.objectContaining({ create: expect.objectContaining({ branchId: 'branch-2', languageId: 'language-2' }) }),
    ]);
  });
});

/**
 * The dashboard's connected Connection configuration save, end to end on the
 * server side: the body its own model builds from the typed values and the
 * latest confirmed status, through the real validator and `connectGitHub`, read
 * back as the form reads it and judged by the form's own `toSent`.
 */
describe("the dashboard's Connection configuration save", () => {
  const targeted = () => ({ ...storedConnection(), contentPath: 'docs', importBranchId: 'branch-2', importLanguageId: 'language-2' });
  const typed = (overrides: Partial<GitWorkflowConnectionValues>) => ({ ...gitWorkflowConnectionValues(targeted()), ...overrides });

  it.each([
    ['a GitHub URL with .git and padding', typed({ repository: '  https://github.com/acme/moved.git  ' })],
    ['refs/heads/ branches', typed({ baseBranch: ' refs/heads/main ', headBranch: 'refs/heads/nibleaf/edit' })],
    ['a path with slashes and backslashes', typed({ contentPath: ' /contentguides/ ' })],
    ['a blank path (the repository root)', typed({ contentPath: '   ' })],
  ])('stores %s as the form expects, keeping the import targets and the stored credential', async (_name, values) => {
    const stored = targeted();
    installConnection(stored);
    // The latest confirmed status: what the status endpoint returns for the stored row.
    const { credentialEncrypted: _credential, webhookSecretEncrypted: _webhook, ...status } = stored;

    const body = gitConnectionBody.parse(gitWorkflowConnectionPayload(values, status, '   '));
    const result = await connectGitHub('project-1', 'user-1', body);

    expect(gitWorkflowConnectionValues(result.connection)).toEqual(sentGitWorkflowConnectionValues(values));
    expect(result.connection).toMatchObject({ importBranchId: 'branch-2', importLanguageId: 'language-2', credentialConfigured: true });
    expect(savedData()).not.toHaveProperty('credentialEncrypted');
    expect(savedData()).not.toHaveProperty('webhookSecretEncrypted');
    // A blank token is left out: the stored credential is the one used.
    expect(mocks.providerTokens).toEqual([STORED_TOKEN]);
  });

  it('stores the readback the form adopts for a typed URL', async () => {
    installConnection(targeted());
    const values = typed({ repository: 'HTTPS://GITHUB.COM/acme/moved.GIT', contentPath: 'docs/' });
    const result = await connectGitHub('project-1', 'user-1', gitConnectionBody.parse(gitWorkflowConnectionPayload(values, targeted())));
    expect(gitWorkflowConnectionValues(result.connection)).toEqual({
      repository: 'acme/moved',
      baseBranch: 'main',
      headBranch: 'nibleaf/docs',
      contentPath: 'docs',
    });
  });
});

/**
 * The connect wizard's first Connect, on the server side: the body it sends (the settings as typed, its defaults for
 * the branches and path, the token as typed, no import targets), through the real validator and `connectGitHub`.
 */
describe("the connect wizard's first Connect", () => {
  it('stores the normalized settings, the token as sent and a generated webhook secret, with no import targets', async () => {
    installConnection(null);
    const token = '  test-token-0003-placeholder  ';

    const body = gitConnectionBody.parse({
      repository: '  acme/docs  ',
      baseBranch: 'main',
      headBranch: 'nibleaf/docs',
      contentPath: 'docs',
      token,
    });
    const result = await connectGitHub('project-1', 'user-1', body);

    expect(mocks.providerTokens).toEqual([token]);
    const { create } = firstInput<{ create: Record<string, unknown> }>(mocks.prisma.gitConnection.upsert);
    expect(create).toMatchObject({
      repository: 'acme/docs',
      baseBranch: 'main',
      headBranch: 'nibleaf/docs',
      contentPath: 'docs',
      importBranchId: null,
      importLanguageId: null,
    });
    expect(decryptGitSecret(create.credentialEncrypted as string)).toBe(token);
    expect(result.webhookSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(decryptGitSecret(create.webhookSecretEncrypted as string)).toBe(result.webhookSecret);
    expect(JSON.stringify(result.connection)).not.toContain(token.trim());
  });
});
