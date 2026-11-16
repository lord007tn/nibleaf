import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prisma = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    branch: { findFirst: vi.fn() },
    gitAuditEvent: { count: vi.fn(), create: vi.fn() },
    gitConflict: { createMany: vi.fn(), findMany: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    gitConnection: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    gitFileState: { createMany: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    gitPreview: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    gitPullRequest: { upsert: vi.fn() },
    gitSyncOperation: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    gitWebhookDelivery: { updateMany: vi.fn() },
    pageGitImportSource: { deleteMany: vi.fn() },
    language: { findFirst: vi.fn() },
    page: {
      aggregate: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    project: { findUnique: vi.fn() },
  };
  const provider = {
    createBranch: vi.fn(),
    createCommit: vi.fn(),
    getBranchSha: vi.fn(),
    getPullRequest: vi.fn(),
    listMarkdownFiles: vi.fn(),
    listThemeRepositoryFiles: vi.fn(),
    updateBranch: vi.fn(),
    upsertDraftPullRequest: vi.fn(),
    verifyWriteAccess: vi.fn(),
  };
  return {
    createJob: vi.fn(),
    getDefaultBranch: vi.fn(),
    getDefaultLanguage: vi.fn(),
    getCurrentSnapshot: vi.fn(),
    parseFrontmatter: vi.fn(),
    prisma,
    provider,
  };
});

vi.mock('@nibleaf/bullmq', () => ({
  createJob: mocks.createJob,
  QueueNames: { GIT: 'git' },
  QUEUE_CONFIGS: { git: { operationClaimTimeout: 12 * 60 * 1000 } },
}));
vi.mock('@nibleaf/database', () => ({ prisma: mocks.prisma, Prisma: { join: (values: unknown[]) => values, DbNull: null } }));
// The repository generator derives docs.json navigation with the real buildNavTree.
vi.mock('@nibleaf/shared/site', async (importOriginal) => ({ ...(await importOriginal<object>()), buildSnapshot: vi.fn() }));
vi.mock('../branches', () => ({ getDefaultBranch: mocks.getDefaultBranch }));
vi.mock('../deployments', () => ({
  getCurrentSnapshot: mocks.getCurrentSnapshot,
}));
vi.mock('../importers/content', async (importOriginal) => {
  // The real serializer/parser (shared with the MCP Markdown resource); parsing
  // stays spy-able per test.
  const actual = await importOriginal<typeof import('../importers/content')>();
  return { ...actual, parseFrontmatter: mocks.parseFrontmatter };
});
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
    listThemeRepositoryFiles = mocks.provider.listThemeRepositoryFiles;
    updateBranch = mocks.provider.updateBranch;
    upsertDraftPullRequest = mocks.provider.upsertDraftPullRequest;
    verifyWriteAccess = mocks.provider.verifyWriteAccess;
  },
}));
vi.mock('./reconcile', () => ({
  conflictSnapshotMatches: vi.fn(),
  repositoryOurs: vi.fn((_ownership: string, state: { baseContent: string | null; baseExists: boolean } | undefined, generated: string | null) =>
    _ownership === 'CUSTOMER' && state ? (state.baseExists ? state.baseContent : null) : generated,
  ),
  reconcileOwnedFile: vi.fn((_ownership: string, base: string | null, ours: string | null, theirs: string | null) => {
    if (_ownership === 'PLATFORM' && theirs !== base && theirs !== ours) return { conflict: true, content: null, source: 'conflict' };
    if (ours === theirs) return { conflict: false, content: ours, source: 'unchanged' };
    if (ours === base) return { conflict: false, content: theirs, source: 'theirs' };
    if (theirs === base) return { conflict: false, content: ours, source: 'ours' };
    return { conflict: true, content: null, source: 'conflict' };
  }),
}));

import { buildThemeRepository, THEME_REPOSITORY_DOCS_CONFIG_PATH, THEME_REPOSITORY_MANIFEST_PATH } from '@nibleaf/shared/theme-repository';
import { serializeGitPage } from '../importers/content';
import { applyGitContentChanges, type ObservedPage } from './apply';
import { connectGitHub, processGitOperation } from './workflow';

const actualContent = await vi.importActual<typeof import('../importers/content')>('../importers/content');

/** A small in-memory `page` table with the Prisma semantics the Git apply
 * relies on: conditional updateMany/deleteMany, and an interactive transaction
 * that rolls every page write back when its callback throws. */
type PageRow = {
  id: string;
  projectId: string;
  branchId: string;
  languageId: string;
  parentId: string | null;
  kind: 'PAGE' | 'GROUP';
  title: string;
  slug: string;
  path: string;
  content: string;
  description: string | null;
  icon: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
};
const pageStore = { rows: [] as PageRow[], clock: 1, ids: 0 };
const tick = () => new Date(Date.UTC(2026, 10, 7, 0, 0, pageStore.clock++));
const rowMatches = (row: PageRow, where: Record<string, unknown> = {}) =>
  Object.entries(where).every(([key, expected]) => {
    if (expected === undefined) return true;
    const actual = row[key as keyof PageRow];
    if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
    if (expected && typeof expected === 'object' && 'in' in expected) return (expected as { in: unknown[] }).in.includes(actual);
    return actual === expected;
  });
const installPageStore = () => {
  pageStore.rows = [];
  pageStore.clock = 1;
  pageStore.ids = 0;
  const page = mocks.prisma.page;
  page.findMany.mockImplementation(async ({ where }: { where?: Record<string, unknown> } = {}) =>
    pageStore.rows.filter((row) => rowMatches(row, where)).map((row) => ({ ...row })),
  );
  page.findFirst.mockImplementation(async ({ where }: { where?: Record<string, unknown> } = {}) => {
    const row = pageStore.rows.find((candidate) => rowMatches(candidate, where));
    return row ? { ...row } : null;
  });
  page.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<PageRow> }) => {
    const row = pageStore.rows.find((candidate) => candidate.id === where.id);
    if (!row) throw new Error('Record to update not found.');
    Object.assign(row, data, { updatedAt: tick() });
    return { ...row };
  });
  page.updateMany.mockImplementation(async ({ where, data }: { where: Record<string, unknown>; data: Partial<PageRow> }) => {
    const rows = pageStore.rows.filter((row) => rowMatches(row, where));
    for (const row of rows) Object.assign(row, data, { updatedAt: tick() });
    return { count: rows.length };
  });
  page.deleteMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    // Page.parent is ON DELETE CASCADE: children go with their parent.
    const matched = pageStore.rows.filter((row) => rowMatches(row, where)).map((row) => row.id);
    const doomed = new Set(matched);
    for (let grew = true; grew; ) {
      grew = false;
      for (const row of pageStore.rows) {
        if (row.parentId && doomed.has(row.parentId) && !doomed.has(row.id)) {
          doomed.add(row.id);
          grew = true;
        }
      }
    }
    pageStore.rows = pageStore.rows.filter((row) => !doomed.has(row.id));
    return { count: matched.length };
  });
  page.create.mockImplementation(async ({ data }: { data: Partial<PageRow> }) => {
    const now = tick();
    const row = {
      id: `created-${++pageStore.ids}`,
      parentId: null,
      description: null,
      icon: null,
      position: 0,
      createdAt: now,
      updatedAt: now,
      ...data,
    } as PageRow;
    pageStore.rows.push(row);
    return { ...row };
  });
  page.aggregate.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    const positions = pageStore.rows.filter((row) => rowMatches(row, where)).map((row) => row.position);
    return { _max: { position: positions.length ? Math.max(...positions) : null } };
  });
};
const seedPage = (fields: Pick<PageRow, 'id' | 'title' | 'slug' | 'content'> & Partial<Pick<PageRow, 'parentId' | 'path' | 'kind'>>) => {
  const now = tick();
  const row: PageRow = {
    projectId: 'project-1',
    branchId: 'branch-1',
    languageId: 'language-1',
    parentId: null,
    kind: 'PAGE',
    path: fields.slug,
    description: null,
    icon: null,
    position: pageStore.rows.length,
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
  pageStore.rows.push(row);
  return row;
};
const snapshotPage = (row: PageRow) => ({
  id: row.id,
  parentId: row.parentId,
  versionId: 'branch-1',
  languageCode: 'en',
  kind: row.kind,
  title: row.title,
  slug: row.slug,
  path: `/${row.path}`,
  icon: row.icon,
  description: row.description,
  content: row.content,
  config: null,
  translationKey: null,
  position: row.position,
  hidden: false,
  updatedAt: row.updatedAt.toISOString(),
});

const currentSnapshot = {
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

/** Every ledger row the sync wrote: bulk-created rows and updated rows. */
const ledgerWrites = () => [
  ...mocks.prisma.gitFileState.createMany.mock.calls.flatMap(
    ([input]) => (input as { data: Array<{ path: string; pageId: string | null; ownership: string }> }).data,
  ),
  ...mocks.prisma.gitFileState.update.mock.calls.map(([input]) => {
    const { where, data } = input as { where: { connectionId_path: { path: string } }; data: { pageId: string | null; ownership: string } };
    return { path: where.connectionId_path.path, ...data };
  }),
];

beforeEach(() => {
  vi.clearAllMocks();
  installPageStore();
  mocks.parseFrontmatter.mockImplementation(actualContent.parseFrontmatter);
  mocks.prisma.$transaction.mockImplementation(async (input: unknown, _options?: unknown) => {
    if (typeof input !== 'function') return Promise.all(input as Promise<unknown>[]);
    const saved = pageStore.rows.map((row) => ({ ...row }));
    try {
      return await input(mocks.prisma);
    } catch (error) {
      pageStore.rows = saved;
      throw error;
    }
  });
  mocks.prisma.gitSyncOperation.findUnique.mockResolvedValue(operation());
  mocks.prisma.gitSyncOperation.findFirst.mockResolvedValue(null);
  mocks.prisma.gitSyncOperation.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.gitSyncOperation.update.mockResolvedValue({});
  mocks.prisma.gitConnection.update.mockResolvedValue({});
  mocks.prisma.gitConnection.findUnique.mockResolvedValue(null);
  mocks.getCurrentSnapshot.mockResolvedValue(currentSnapshot);
  mocks.prisma.gitFileState.findMany.mockResolvedValue([]);
  mocks.prisma.gitConflict.findMany.mockResolvedValue([]);
  mocks.prisma.gitAuditEvent.create.mockResolvedValue({});
  mocks.prisma.gitAuditEvent.count.mockResolvedValue(0);
  mocks.getDefaultBranch.mockResolvedValue({ id: 'branch-1', name: 'Main' });
  mocks.getDefaultLanguage.mockResolvedValue({ id: 'language-1', code: 'en' });
  mocks.provider.getBranchSha.mockImplementation(async (_repository: string, branch: string) => (branch === 'main' ? 'base-sha' : 'head-sha'));
  mocks.provider.listMarkdownFiles.mockResolvedValue([]);
  mocks.provider.listThemeRepositoryFiles.mockResolvedValue([]);
});

describe('connectGitHub', () => {
  it('validates generated platform files before persisting the connection or baseline', async () => {
    const remoteFiles = buildThemeRepository(currentSnapshot).map((file, index) => ({
      path: file.path,
      sha: `blob-${index}`,
      content: file.content,
    }));
    const snapshotFile = remoteFiles.find((file) => file.path === THEME_REPOSITORY_DOCS_CONFIG_PATH);
    expect(snapshotFile).toBeDefined();
    if (!snapshotFile) return;
    snapshotFile.content = '{}\n';
    mocks.provider.listThemeRepositoryFiles.mockResolvedValueOnce(remoteFiles);

    await expect(
      connectGitHub('project-1', 'user-1', {
        repository: 'acme/docs',
        baseBranch: 'main',
        headBranch: 'nibleaf/docs',
        token: 'token',
      }),
    ).rejects.toThrow(/docs\.json.*generated by Nibleaf/);

    expect(mocks.prisma.gitConnection.upsert).not.toHaveBeenCalled();
    expect(ledgerWrites()).toEqual([]);
  });
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
    expect(mocks.provider.listThemeRepositoryFiles).toHaveBeenCalledOnce();
    expect(mocks.prisma.gitSyncOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'operation-1' }, data: expect.objectContaining({ status: 'SUCCEEDED', remoteSha: 'head-sha' }) }),
    );
  });

  it('does not tombstone customer scaffolding when a pull precedes the first push', async () => {
    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();

    const customerCreates = ledgerWrites().filter((row) => row.ownership === 'CUSTOMER');
    expect(customerCreates).toEqual([]);
  });

  it('seeds customer scaffolding on push while no customer ledger row exists', async () => {
    mocks.prisma.gitSyncOperation.findUnique.mockResolvedValue({
      ...operation(),
      kind: 'PUSH',
      commitMessage: 'Seed the Harbor theme',
    });
    mocks.provider.createCommit.mockResolvedValue('commit-sha');

    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();

    expect(mocks.provider.createCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        files: expect.arrayContaining([expect.objectContaining({ path: 'src/components/layout/HarborLayout.tsx', content: expect.any(String) })]),
      }),
    );
  });

  it('rejects a repository manifest for a different configured theme', async () => {
    mocks.provider.listThemeRepositoryFiles.mockResolvedValue([
      {
        path: THEME_REPOSITORY_MANIFEST_PATH,
        sha: 'manifest-sha',
        content: JSON.stringify({
          kind: 'nibleaf-theme-repository',
          schemaVersion: 2,
          project: { id: 'project-1', slug: 'docs' },
          template: { id: 'signal', version: 2 },
          runtime: { strategy: 'docs-json', contractVersion: 2, entry: 'src/lib/site.ts' },
        }),
      },
    ]);

    await expect(processGitOperation('operation-1')).rejects.toThrow(/configured for harbor/);

    expect(mocks.prisma.gitSyncOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'operation-1' }, data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });

  it('fails closed on a schema v1 repository instead of reconciling its files', async () => {
    mocks.provider.listThemeRepositoryFiles.mockResolvedValue([
      {
        path: 'nibleaf.theme.json',
        sha: 'manifest-sha',
        content: JSON.stringify({
          kind: 'nibleaf-theme-repository',
          schemaVersion: 1,
          project: { id: 'project-1', slug: 'docs' },
          template: { id: 'harbor', version: 1 },
          runtime: { strategy: 'vendored', contractVersion: 1, entry: 'src/nibleaf/runtime.ts' },
        }),
      },
      { path: '.nibleaf/snapshot.json', sha: 'snapshot-sha', content: '{}\n' },
    ]);

    await expect(processGitOperation('operation-1')).rejects.toThrow(/schema v1 .* no longer supported/);

    expect(ledgerWrites()).toEqual([]);
    expect(mocks.prisma.page.update).not.toHaveBeenCalled();
  });

  it('persists modified generated platform data as a conflict without advancing file state', async () => {
    const remoteFiles = buildThemeRepository(currentSnapshot).map((file, index) => ({
      path: file.path,
      sha: `blob-${index}`,
      content: file.content,
    }));
    const snapshotFile = remoteFiles.find((file) => file.path === THEME_REPOSITORY_DOCS_CONFIG_PATH);
    expect(snapshotFile).toBeDefined();
    if (!snapshotFile) return;
    snapshotFile.content = '{}\n';
    mocks.provider.listThemeRepositoryFiles.mockResolvedValueOnce(remoteFiles);
    mocks.prisma.gitConflict.findMany.mockResolvedValueOnce([
      {
        id: 'conflict-1',
        path: THEME_REPOSITORY_DOCS_CONFIG_PATH,
        status: 'OPEN',
        baseContent: null,
        oursContent: buildThemeRepository(currentSnapshot).find((file) => file.path === THEME_REPOSITORY_DOCS_CONFIG_PATH)?.content ?? null,
        theirsContent: '{}\n',
      },
    ]);

    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();

    expect(mocks.prisma.gitConflict.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ path: THEME_REPOSITORY_DOCS_CONFIG_PATH })]) }),
    );
    expect(mocks.prisma.gitSyncOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'operation-1' }, data: expect.objectContaining({ status: 'CONFLICT' }) }),
    );
    expect(ledgerWrites()).toEqual([]);
  });

  it('reconciles exported version and language paths back to the source page', async () => {
    const page = {
      id: 'page-1',
      parentId: null,
      versionId: 'branch-1',
      languageCode: 'en',
      kind: 'PAGE' as const,
      title: 'Welcome',
      slug: 'welcome',
      path: '/welcome',
      icon: null,
      description: null,
      content: 'Original',
      config: null,
      translationKey: null,
      position: 0,
      hidden: false,
      updatedAt: '2026-08-23T00:00:00.000Z',
    };
    mocks.getCurrentSnapshot.mockResolvedValue({ ...currentSnapshot, pages: [page] });
    const observedAt = new Date('2026-08-23T00:00:00.000Z');
    mocks.prisma.page.findMany.mockResolvedValue([
      {
        id: page.id,
        parentId: null,
        kind: 'PAGE',
        title: page.title,
        path: page.path,
        content: page.content,
        description: page.description,
        icon: page.icon,
        updatedAt: observedAt,
      },
    ]);
    mocks.prisma.page.updateMany.mockResolvedValue({ count: 1 });
    mocks.parseFrontmatter.mockReturnValue({ body: 'Updated from Git', meta: {} });
    const baseContent = '---\ntitle: "Welcome"\n---\n\nOriginal';
    const remoteContent = '---\ntitle: "Welcome"\n---\n\nUpdated from Git';
    mocks.prisma.gitFileState.findMany.mockResolvedValue([{ path: 'welcome.mdx', baseContent, baseExists: true, pageId: null, ownership: 'SHARED' }]);
    mocks.provider.listThemeRepositoryFiles.mockResolvedValue([{ path: 'welcome.mdx', sha: 'edited', content: remoteContent }]);

    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();

    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: page.id, updatedAt: observedAt }),
        data: expect.objectContaining({ content: 'Updated from Git' }),
      }),
    );
    expect(mocks.prisma.gitFileState.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ pageId: page.id }) }));
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

describe('processGitOperation applying Git changes to pages', () => {
  const arabicSnapshot = {
    ...currentSnapshot,
    project: {
      ...currentSnapshot.project,
      languages: [...currentSnapshot.project.languages, { code: 'ar', label: 'العربية', direction: 'RTL' as const, isDefault: false, config: null }],
    },
  };
  const ledger = (path: string, baseContent: string) => ({ path, baseContent, baseExists: true, pageId: null, ownership: 'SHARED' });
  const remote = (path: string, content: string) => ({ path, sha: `sha-${path}`, content });
  const lastOperationStatus = () =>
    mocks.prisma.gitSyncOperation.update.mock.calls.map(([input]) => (input as { data: { status?: string } }).data.status).filter(Boolean);

  it('does not overwrite a dashboard save made after the merge read, and surfaces it as a conflict', async () => {
    const about = seedPage({ id: 'page-about', title: 'About', slug: 'about', content: 'Original' });
    const base = serializeGitPage(about);
    const upstream = '---\ntitle: "About"\n---\n\nUpdated from Git';
    mocks.getCurrentSnapshot.mockResolvedValue({ ...currentSnapshot, pages: [snapshotPage(about)] });
    mocks.prisma.gitFileState.findMany.mockResolvedValue([ledger('about.mdx', base)]);
    mocks.provider.listThemeRepositoryFiles.mockResolvedValue([remote('about.mdx', upstream)]);
    // The writer saves between the merge read and the apply.
    mocks.prisma.gitConflict.findMany.mockImplementationOnce(async () => {
      const row = pageStore.rows.find((page) => page.id === about.id);
      if (row) Object.assign(row, { content: 'Saved by the writer', updatedAt: tick() });
      return [];
    });

    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();

    expect(pageStore.rows.find((page) => page.id === about.id)?.content).toBe('Saved by the writer');
    expect(mocks.prisma.gitConflict.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          path: 'about.mdx',
          baseContent: base,
          oursContent: expect.stringContaining('Saved by the writer'),
          theirsContent: upstream,
        }),
      }),
    );
    expect(lastOperationStatus()).toContain('CONFLICT');
    expect(lastOperationStatus()).not.toContain('SUCCEEDED');
    expect(ledgerWrites()).toEqual([]);
  });

  it('does not delete a page that was edited after the merge read saw it unchanged', async () => {
    const about = seedPage({ id: 'page-about', title: 'About', slug: 'about', content: 'Original' });
    mocks.getCurrentSnapshot.mockResolvedValue({ ...currentSnapshot, pages: [snapshotPage(about)] });
    mocks.prisma.gitFileState.findMany.mockResolvedValue([ledger('about.mdx', serializeGitPage(about))]);
    mocks.provider.listThemeRepositoryFiles.mockResolvedValue([]);
    mocks.prisma.gitConflict.findMany.mockImplementationOnce(async () => {
      const row = pageStore.rows.find((page) => page.id === about.id);
      if (row) Object.assign(row, { content: 'Saved by the writer', updatedAt: tick() });
      return [];
    });

    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();

    expect(pageStore.rows.find((page) => page.id === about.id)?.content).toBe('Saved by the writer');
    expect(mocks.prisma.gitConflict.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ path: 'about.mdx', theirsContent: null }) }),
    );
    expect(lastOperationStatus()).toContain('CONFLICT');
  });

  it('runs the sync again instead of reporting a conflict when the concurrent save already matches Git', async () => {
    const about = seedPage({ id: 'page-about', title: 'About', slug: 'about', content: 'Original' });
    mocks.getCurrentSnapshot.mockResolvedValue({ ...currentSnapshot, pages: [snapshotPage(about)] });
    mocks.prisma.gitFileState.findMany.mockResolvedValue([ledger('about.mdx', serializeGitPage(about))]);
    mocks.provider.listThemeRepositoryFiles.mockResolvedValue([remote('about.mdx', '---\ntitle: "About"\n---\n\nSame text')]);
    mocks.prisma.gitConflict.findMany.mockImplementationOnce(async () => {
      const row = pageStore.rows.find((page) => page.id === about.id);
      if (row) Object.assign(row, { content: 'Same text', updatedAt: tick() });
      return [];
    });

    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();

    expect(mocks.prisma.gitConflict.upsert).not.toHaveBeenCalled();
    expect(lastOperationStatus()).toEqual(['QUEUED']);
    expect(mocks.createJob).toHaveBeenCalledWith('git', { name: 'process-git-operation', data: { operationId: 'operation-1' } }, expect.anything());
  });

  it('applies nothing when one file of a multi-file sync fails', async () => {
    const about = seedPage({ id: 'page-about', title: 'About', slug: 'about', content: 'Original' });
    mocks.getCurrentSnapshot.mockResolvedValue({ ...arabicSnapshot, pages: [snapshotPage(about)] });
    mocks.prisma.gitFileState.findMany.mockResolvedValue([ledger('about.mdx', serializeGitPage(about))]);
    mocks.provider.listThemeRepositoryFiles.mockResolvedValue([
      remote('about.mdx', '---\ntitle: "About"\n---\n\nUpdated from Git'),
      // A new Arabic page while this connection syncs English only.
      remote('ar/البدء.mdx', '# البدء'),
    ]);

    const failure = await processGitOperation('operation-1').then(
      () => null,
      (error: unknown) => error,
    );

    expect(pageStore.rows).toHaveLength(1);
    expect(pageStore.rows[0]?.content).toBe('Original');
    expect(ledgerWrites()).toEqual([]);
    expect(String(failure)).toMatch(/nothing was changed in Nibleaf.*ar\/البدء\.mdx is outside/);
    expect(mocks.prisma.gitSyncOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', error: expect.stringContaining('nothing was changed') }) }),
    );
  });

  it('rolls back earlier pages when a database write fails part-way', async () => {
    const about = seedPage({ id: 'page-about', title: 'About', slug: 'about', content: 'Original' });
    mocks.getCurrentSnapshot.mockResolvedValue({ ...currentSnapshot, pages: [snapshotPage(about)] });
    mocks.prisma.gitFileState.findMany.mockResolvedValue([ledger('about.mdx', serializeGitPage(about))]);
    mocks.provider.listThemeRepositoryFiles.mockResolvedValue([
      remote('about.mdx', '---\ntitle: "About"\n---\n\nUpdated from Git'),
      remote('guide.mdx', '# Guide'),
    ]);
    mocks.prisma.page.create.mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));

    const failure = await processGitOperation('operation-1').then(
      () => null,
      (error: unknown) => error,
    );

    expect(pageStore.rows.map((page) => [page.id, page.content])).toEqual([['page-about', 'Original']]);
    expect(String(failure)).toMatch(/nothing was changed in Nibleaf/);
  });

  it('creates distinct pages with Arabic slugs for new Arabic files', async () => {
    mocks.prisma.gitFileState.findMany.mockResolvedValue([]);
    mocks.provider.listThemeRepositoryFiles.mockResolvedValue([
      remote('البدء.mdx', '---\ntitle: "البدء"\n---\n\nمرحبا'),
      remote('النشر.mdx', '---\ntitle: "النشر"\n---\n\nانشر'),
    ]);

    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();

    const pages = pageStore.rows.filter((page) => page.kind === 'PAGE');
    expect(pages.map((page) => [page.slug, page.content.trim()]).sort()).toEqual([
      ['البدء', 'مرحبا'],
      ['النشر', 'انشر'],
    ]);
    const ledgerPageIds = ledgerWrites()
      .filter((row) => row.path.endsWith('.mdx'))
      .map((row) => row.pageId);
    expect(new Set(ledgerPageIds).size).toBe(2);
    expect(ledgerPageIds).not.toContain(null);
  });
});

describe('Git apply safety', () => {
  const ledger = (path: string, baseContent: string) => ({ path, baseContent, baseExists: true, pageId: null, ownership: 'SHARED' });
  const remote = (path: string, content: string) => ({ path, sha: `sha-${path}`, content });
  const statuses = () =>
    mocks.prisma.gitSyncOperation.update.mock.calls.map(([input]) => (input as { data: { status?: string } }).data.status).filter(Boolean);
  const seedTree = () => {
    const parent = seedPage({ id: 'page-guide', title: 'Guide', slug: 'guide', content: 'Guide' });
    const child = seedPage({ id: 'page-setup', title: 'Setup', slug: 'setup', path: 'guide/setup', parentId: parent.id, content: 'Setup' });
    mocks.getCurrentSnapshot.mockResolvedValue({ ...currentSnapshot, pages: [snapshotPage(parent), snapshotPage(child)] });
    mocks.prisma.gitFileState.findMany.mockResolvedValue([
      ledger('guide.mdx', serializeGitPage(parent)),
      ledger('guide/setup.mdx', serializeGitPage(child)),
    ]);
    return { parent, child };
  };

  it('treats a save in the same millisecond as a change: the revision includes the content', async () => {
    const about = seedPage({ id: 'page-about', title: 'About', slug: 'about', content: 'Original' });
    mocks.getCurrentSnapshot.mockResolvedValue({ ...currentSnapshot, pages: [snapshotPage(about)] });
    mocks.prisma.gitFileState.findMany.mockResolvedValue([ledger('about.mdx', serializeGitPage(about))]);
    mocks.provider.listThemeRepositoryFiles.mockResolvedValue([remote('about.mdx', '---\ntitle: "About"\n---\n\nUpdated from Git')]);
    mocks.prisma.gitConflict.findMany.mockImplementationOnce(async () => {
      // Same updatedAt, different content.
      const row = pageStore.rows.find((page) => page.id === about.id);
      if (row) row.content = 'Saved by the writer';
      return [];
    });

    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();

    expect(pageStore.rows.find((page) => page.id === about.id)?.content).toBe('Saved by the writer');
    expect(statuses()).toContain('CONFLICT');
  });

  it('puts a new file under a page that becomes its folder in the same pull', async () => {
    const { child } = seedTree();
    Object.assign(pageStore.rows[0] as PageRow, { config: { sidebarTitle: 'Guide', seo: { noindex: true } } });
    mocks.provider.listThemeRepositoryFiles.mockResolvedValue([
      remote('guide/setup.mdx', serializeGitPage(child)),
      remote('guide/new.mdx', '---\ntitle: "New"\n---\n\nNew page'),
    ]);

    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();

    const created = pageStore.rows.find((page) => page.title === 'New');
    expect(created).toMatchObject({ parentId: 'page-guide', path: 'guide/new' });
    expect(pageStore.rows.filter((page) => page.kind === 'GROUP').map((page) => page.id)).toEqual(['page-guide']);
    // The folder keeps its sidebar label only, and is no imported file's page.
    expect((pageStore.rows[0] as PageRow & { config?: unknown }).config).toEqual({ sidebarTitle: 'Guide' });
    expect(mocks.prisma.pageGitImportSource.deleteMany).toHaveBeenCalledWith({ where: { pageId: 'page-guide' } });
    expect(statuses()).toContain('SUCCEEDED');
  });

  it('keeps a sub-page Git still has when Git deletes its parent page, and the next push leaves it alone', async () => {
    const { child } = seedTree();
    mocks.provider.listThemeRepositoryFiles.mockResolvedValue([remote('guide/setup.mdx', serializeGitPage(child))]);

    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();

    // The parent's own content is gone; it stays as the folder of its sub-page.
    expect(pageStore.rows.map((page) => [page.id, page.kind, page.path, page.content])).toEqual([
      ['page-guide', 'GROUP', 'guide', ''],
      ['page-setup', 'PAGE', 'guide/setup', 'Setup'],
    ]);
    expect(statuses()).toContain('SUCCEEDED');
    expect(mocks.prisma.gitConflict.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.gitFileState.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ path: { in: ['guide.mdx'] } }) }),
    );
    expect(ledgerWrites().find((row) => row.path === 'guide/setup.mdx')?.pageId).toBe('page-setup');

    // Next push, from the ledger the pull left behind.
    vi.clearAllMocks();
    mocks.getCurrentSnapshot.mockResolvedValue({ ...currentSnapshot, pages: pageStore.rows.map(snapshotPage) });
    mocks.prisma.gitFileState.findMany.mockResolvedValue([{ ...ledger('guide/setup.mdx', serializeGitPage(child)), pageId: 'page-setup' }]);
    mocks.prisma.gitSyncOperation.findUnique.mockResolvedValue({
      ...operation(),
      kind: 'PUSH',
      commitMessage: 'Docs',
      authorName: 'A',
      authorEmail: 'a@example.invalid',
    });
    mocks.provider.createCommit.mockResolvedValue('commit-sha');

    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();

    const pushed = mocks.provider.createCommit.mock.calls.flatMap(([input]) =>
      (input as { files: Array<{ path: string }> }).files.map((file) => file.path),
    );
    expect(pushed.filter((path) => path.startsWith('guide'))).toEqual([]);
    expect(pageStore.rows.map((page) => page.id)).toEqual(['page-guide', 'page-setup']);
  });

  it('does not delete a subtree whose child was saved after the merge read', async () => {
    seedTree();
    mocks.provider.listThemeRepositoryFiles.mockResolvedValue([]);
    mocks.prisma.gitConflict.findMany.mockImplementationOnce(async () => {
      const row = pageStore.rows.find((page) => page.id === 'page-setup');
      if (row) Object.assign(row, { content: 'Saved by the writer', updatedAt: tick() });
      return [];
    });

    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();

    expect(pageStore.rows.find((page) => page.id === 'page-setup')?.content).toBe('Saved by the writer');
    expect(pageStore.rows).toHaveLength(2);
    expect(statuses()).toContain('CONFLICT');
  });

  it('deletes a parent together with children Git deleted too', async () => {
    seedTree();
    mocks.provider.listThemeRepositoryFiles.mockResolvedValue([]);

    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();

    expect(pageStore.rows).toEqual([]);
    expect(statuses()).toContain('SUCCEEDED');
  });

  const applyContext = (observed: ObservedPage[]) => ({
    projectId: 'project-1',
    contentPath: '',
    branch: { id: 'branch-1', name: 'Main' },
    language: { id: 'language-1', code: 'en' },
    snapshot: currentSnapshot,
    observed: new Map(observed.map((page) => [page.id, page])),
  });

  it('never overwrites a page a writer created between the page read and the snapshot read', async () => {
    mocks.prisma.gitFileState.findMany.mockResolvedValue([]);
    mocks.provider.listThemeRepositoryFiles.mockResolvedValue([remote('intro.mdx', '---\ntitle: "Intro"\n---\n\nFrom Git')]);
    // The writer's page commits after the merge's page read, before its snapshot read.
    mocks.getCurrentSnapshot.mockImplementation(async () => {
      if (!pageStore.rows.some((page) => page.id === 'page-intro')) {
        seedPage({ id: 'page-intro', title: 'Intro', slug: 'intro', content: 'Written by a writer' });
      }
      return { ...currentSnapshot, pages: pageStore.rows.map(snapshotPage) };
    });

    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();

    expect(pageStore.rows.find((page) => page.id === 'page-intro')?.content).toBe('Written by a writer');
    expect(mocks.prisma.gitConflict.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ path: 'intro.mdx', oursContent: expect.stringContaining('Written by a writer') }),
      }),
    );
    expect(statuses()).toContain('CONFLICT');
  });

  it('leaves a stale link to a page outside the synced language alone and gives the file its own page', async () => {
    seedPage({ id: 'page-other', title: 'Intro', slug: 'intro', content: 'Another language' });
    Object.assign(pageStore.rows[0] as PageRow, { languageId: 'language-2' });

    const pageIds = await applyGitContentChanges(mocks.prisma as never, applyContext([]), [
      { type: 'write', path: 'intro.mdx', pageId: 'page-other', content: '---\ntitle: "Intro"\n---\n\nFrom Git' },
    ]);

    expect(pageStore.rows.find((page) => page.id === 'page-other')?.content).toBe('Another language');
    expect(pageIds.get('intro.mdx')).not.toBe('page-other');
    expect(pageStore.rows.find((page) => page.id === pageIds.get('intro.mdx'))?.content).toContain('From Git');
  });

  it('never deletes a page the merge did not read, and takes the project lock before page rows', async () => {
    seedPage({ id: 'page-elsewhere', title: 'Elsewhere', slug: 'elsewhere', content: 'Keep me' });

    const pageIds = await applyGitContentChanges(mocks.prisma as never, applyContext([]), [
      { type: 'delete', path: 'elsewhere.mdx', pageId: 'page-elsewhere' },
    ]);

    expect(pageIds.get('elsewhere.mdx')).toBeNull();
    expect(pageStore.rows.map((page) => page.id)).toEqual(['page-elsewhere']);
    const locks = mocks.prisma.$queryRaw.mock.calls.map(([sql]) => (sql as string[]).join('?'));
    expect(locks[0]).toContain('FROM "project"');
    expect(locks[0]).toContain('FOR NO KEY UPDATE');
    expect(locks[1]).toContain('FROM "page"');
    expect(locks[1]).toContain('ORDER BY "id" FOR NO KEY UPDATE');
  });

  it('requeues with backoff, then stops after three tries when pages keep changing', async () => {
    const about = seedPage({ id: 'page-about', title: 'About', slug: 'about', content: 'Original' });
    mocks.getCurrentSnapshot.mockResolvedValue({ ...currentSnapshot, pages: [snapshotPage(about)] });
    mocks.prisma.gitFileState.findMany.mockResolvedValue([ledger('about.mdx', serializeGitPage(about))]);
    const upstream = '---\ntitle: "About"\n---\n\nSame text';
    mocks.provider.listThemeRepositoryFiles.mockResolvedValue([remote('about.mdx', upstream)]);
    const saveSameText = async () => {
      const row = pageStore.rows.find((page) => page.id === about.id);
      if (row) Object.assign(row, { content: 'Same text', updatedAt: tick() });
      return [];
    };
    mocks.prisma.gitConflict.findMany.mockImplementationOnce(saveSameText);
    mocks.prisma.gitAuditEvent.count.mockResolvedValueOnce(1);

    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();
    expect(mocks.createJob).toHaveBeenCalledWith('git', expect.anything(), expect.objectContaining({ delay: 10_000 }));

    vi.clearAllMocks();
    Object.assign(pageStore.rows[0] as PageRow, { content: 'Original' });
    mocks.prisma.gitConflict.findMany.mockImplementationOnce(saveSameText);
    mocks.prisma.gitAuditEvent.count.mockResolvedValueOnce(3);

    await expect(processGitOperation('operation-1')).rejects.toThrow(/stopped after 3 tries/);
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(statuses()).toContain('FAILED');
  });

  // 800 KiB of invalid UTF-8 is within the 2,000,000-byte blob limit, but decodes
  // (as the GitHub provider decodes blobs) to 800 Ki U+FFFD characters: 2.4 MiB.
  const invalidUtf8 = () => Buffer.alloc(800 * 1024, 0xff).toString('utf8');

  it('refuses a file whose decoded body would grow a page past the size cap, and changes nothing', async () => {
    const about = seedPage({ id: 'page-about', title: 'About', slug: 'about', content: 'Original' });
    mocks.getCurrentSnapshot.mockResolvedValue({ ...currentSnapshot, pages: [snapshotPage(about)] });
    mocks.prisma.gitFileState.findMany.mockResolvedValue([ledger('about.mdx', serializeGitPage(about))]);
    mocks.provider.listThemeRepositoryFiles.mockResolvedValue([
      remote('about.mdx', `---\ntitle: "About"\n---\n\n${invalidUtf8()}`),
      remote('new.mdx', `---\ntitle: "New"\n---\n\n${invalidUtf8()}`),
    ]);

    await expect(processGitOperation('operation-1')).rejects.toThrow(
      /nothing was changed in Nibleaf\. These files are larger than the 2 MiB page limit: about\.mdx, new\.mdx/,
    );
    expect(pageStore.rows.find((page) => page.id === about.id)?.content).toBe('Original');
    expect(pageStore.rows.some((page) => page.title === 'New')).toBe(false);
    expect(statuses()).toContain('FAILED');
  });

  it('applies a file that shrinks a page already over the size cap', async () => {
    // Stored at 3 MiB (saved before the cap); the file brings it to 2.4 MiB.
    const about = seedPage({ id: 'page-about', title: 'About', slug: 'about', content: 'x'.repeat(3 * 1024 * 1024) });
    mocks.getCurrentSnapshot.mockResolvedValue({ ...currentSnapshot, pages: [snapshotPage(about)] });
    mocks.prisma.gitFileState.findMany.mockResolvedValue([ledger('about.mdx', serializeGitPage(about))]);
    const shrunk = invalidUtf8();
    mocks.provider.listThemeRepositoryFiles.mockResolvedValue([remote('about.mdx', `---\ntitle: "About"\n---\n\n${shrunk}`)]);

    await expect(processGitOperation('operation-1')).resolves.toBeUndefined();
    expect(pageStore.rows.find((page) => page.id === about.id)?.content.trim()).toBe(shrunk);
    expect(statuses()).toContain('SUCCEEDED');
  });
});
