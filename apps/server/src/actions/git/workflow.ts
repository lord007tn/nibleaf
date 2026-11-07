import { createHash, randomBytes } from 'node:crypto';
import { createJob, QUEUE_CONFIGS, QueueNames } from '@nibleaf/bullmq';
import { type Prisma, prisma } from '@nibleaf/database';
import {
  buildThemeRepository,
  type ThemeRepositoryOwnership,
  themeContentMap,
  themeRepositoryOwnershipForPath,
  themeRepositoryTemplateId,
  validateThemeRepositoryImport,
} from '@nibleaf/shared/theme-repository';
import { z } from 'zod';
import { env } from '@/env';
import { badRequest, notFound } from '@/errors';
import { getDefaultBranch } from '../branches';
import { getCurrentSnapshot } from '../deployments';
import { serializeGitPage } from '../importers/content';
import { getDefaultLanguage } from '../languages';
import { applyGitContentChanges, GitApplyConflictError, type GitContentChange, type ObservedPage } from './apply';
import { decryptGitSecret, encryptGitSecret, gitCredentialFingerprint } from './crypto';
import { GitHubProvider } from './github';
import { conflictSnapshotMatches, reconcileOwnedFile, repositoryOurs } from './reconcile';
import type { GitProviderClient, RemoteFile, RemotePullRequest } from './types';

const MAX_ERROR = 500;
const MAX_AUDIT_METADATA = 30;
const GIT_OPERATION_CLAIM_TIMEOUT = QUEUE_CONFIGS[QueueNames.GIT].operationClaimTimeout ?? 12 * 60 * 1000;
/** One sync applies up to a few hundred files in a single transaction. */
const GIT_APPLY_TRANSACTION = { timeout: 60_000, maxWait: 10_000 } as const;

export interface ConnectGitInput {
  repository: string;
  baseBranch: string;
  headBranch: string;
  contentPath?: string;
  importBranchId?: string;
  importLanguageId?: string;
  token?: string;
}

export interface QueueGitInput {
  idempotencyKey: string;
  kind: 'PUSH' | 'PULL';
  commitMessage?: string;
  authorName?: string;
  authorEmail?: string;
  createPullRequest?: boolean;
  pullRequestTitle?: string;
  pullRequestBody?: string;
  pullRequestNumber?: number;
  sourceRef?: string;
  sourceSha?: string;
}

const invalidBranchCharacter = (character: string): boolean =>
  character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || '~^:?*[\\'.includes(character) || /\s/.test(character);

const normalizeRepository = (value: string): string => {
  const repository = value
    .trim()
    .replace(/^https:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '');
  const parts = repository.split('/');
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]{1,100}$/.test(part))) {
    throw badRequest('GitHub repository must use owner/repository.');
  }
  return repository;
};

const normalizeGitBranch = (value: string, label = 'Git branch'): string => {
  const branch = value.trim().replace(/^refs\/heads\//, '');
  if (
    !branch ||
    branch.length > 180 ||
    branch.startsWith('.') ||
    branch.endsWith('.') ||
    branch.endsWith('/') ||
    branch.includes('..') ||
    branch.includes('@{') ||
    [...branch].some(invalidBranchCharacter)
  ) {
    throw badRequest(`${label} is not a valid branch name.`);
  }
  return branch;
};

const normalizeGitPath = (value = ''): string => {
  const path = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (path.split('/').some((part) => part === '.' || part === '..') || /^[A-Za-z]:/.test(path)) {
    throw badRequest('Git content path must stay inside the repository.');
  }
  return path;
};

const requestHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const payloadHash = (value: string): string => createHash('sha256').update(value).digest('hex');
const previewToken = (): string => randomBytes(24).toString('base64url');

const audit = async (
  connection: { id: string; projectId: string },
  actorUserId: string | null,
  action: string,
  metadata: Record<string, unknown> = {},
): Promise<void> => {
  const safe = Object.fromEntries(Object.entries(metadata).slice(0, MAX_AUDIT_METADATA));
  await prisma.gitAuditEvent.create({
    data: { connectionId: connection.id, projectId: connection.projectId, actorUserId, action, metadata: safe as Prisma.InputJsonValue },
  });
};

const providerFor = (connection: { provider: string; credentialEncrypted: string | null }): GitProviderClient => {
  if (connection.provider !== 'github') {
    throw badRequest(`Provider ${connection.provider} does not support two-way sync yet.`);
  }
  if (!connection.credentialEncrypted) {
    throw badRequest('Add a GitHub credential before pushing or creating a pull request.');
  }
  return new GitHubProvider(decryptGitSecret(connection.credentialEncrypted));
};

type AuthoringPage = ObservedPage & { path: string };

const authoringContext = async (connection: { projectId: string; importBranchId: string | null; importLanguageId: string | null }) => {
  const [branch, language] = await Promise.all([
    connection.importBranchId
      ? prisma.branch.findFirst({ where: { id: connection.importBranchId, projectId: connection.projectId }, omit: { forkBaseline: true } })
      : getDefaultBranch(connection.projectId),
    connection.importLanguageId
      ? prisma.language.findFirst({ where: { id: connection.importLanguageId, projectId: connection.projectId } })
      : getDefaultLanguage(connection.projectId),
  ]);
  if (!(branch && language)) throw badRequest('The configured Nibleaf branch or language no longer exists.');
  return { branch, language };
};

type LocalRepositoryFile = { page: AuthoringPage | null; content: string; ownership: ThemeRepositoryOwnership };

const localFiles = async (connection: { projectId: string; contentPath: string; importBranchId: string | null; importLanguageId: string | null }) => {
  const { branch, language } = await authoringContext(connection);
  // Every page of the authoring scope, groups included: apply checks a
  // deletion's whole subtree against these revisions.
  const pages: AuthoringPage[] = await prisma.page.findMany({
    where: { projectId: connection.projectId, branchId: branch.id, languageId: language.id },
    orderBy: { path: 'asc' },
    select: { id: true, parentId: true, kind: true, title: true, path: true, content: true, description: true, icon: true, updatedAt: true },
  });
  const snapshot = await getCurrentSnapshot(connection.projectId);
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const contentMap = themeContentMap(snapshot, connection.contentPath);
  const pageIdByPath = new Map(Object.entries(contentMap).map(([pageId, path]) => [path, pageId]));
  const files = new Map<string, LocalRepositoryFile>();
  for (const [path, pageId] of pageIdByPath) {
    const page = pageById.get(pageId);
    if (page?.kind === 'PAGE') files.set(path, { page, content: serializeGitPage(page), ownership: 'SHARED' });
  }
  for (const file of buildThemeRepository(snapshot, { contentPath: connection.contentPath })) {
    files.set(file.path, { page: null, content: file.content, ownership: file.ownership });
  }
  return { files, snapshot, pageIdByPath, observed: pageById as ReadonlyMap<string, ObservedPage> };
};

const initializeFileStates = async (
  connection: {
    id: string;
    projectId: string;
    contentPath: string;
    importBranchId: string | null;
    importLanguageId: string | null;
  },
  files: RemoteFile[],
): Promise<void> => {
  const { files: ours } = await localFiles(connection);
  const { branch, language } = await authoringContext(connection);
  await prisma.$transaction(
    files.map((file) =>
      prisma.gitFileState.upsert({
        where: { connectionId_path: { connectionId: connection.id, path: file.path } },
        create: {
          connectionId: connection.id,
          path: file.path,
          ownership: themeRepositoryOwnershipForPath(file.path, connection.contentPath) ?? 'SHARED',
          pageId: ours.get(file.path)?.page?.id,
          branchId: branch.id,
          languageId: language.id,
          baseContent: file.content,
          baseExists: true,
          baseBlobSha: file.sha,
          remoteBlobSha: file.sha,
        },
        update: {},
      }),
    ),
  );
};

const remoteThemeRepositoryIssues = (files: RemoteFile[], snapshot: Awaited<ReturnType<typeof getCurrentSnapshot>>, contentPath: string) => {
  if (!files.some((file) => themeRepositoryOwnershipForPath(file.path, contentPath) === 'PLATFORM')) return [];
  return validateThemeRepositoryImport(
    new Map(files.map((file) => [file.path, file.content])),
    snapshot,
    contentPath,
    themeRepositoryTemplateId(snapshot),
  );
};

export const connectGitHub = async (projectId: string, actorUserId: string, input: ConnectGitInput) => {
  const repository = normalizeRepository(input.repository);
  const baseBranch = normalizeGitBranch(input.baseBranch, 'Base branch');
  const headBranch = normalizeGitBranch(input.headBranch, 'Authoring branch');
  if (headBranch === baseBranch) throw badRequest('Use a dedicated authoring branch distinct from the base branch.');
  const contentPath = normalizeGitPath(input.contentPath);
  const existing = await prisma.gitConnection.findUnique({ where: { projectId } });
  if (!input.token && !existing?.credentialEncrypted) throw badRequest('A fine-grained GitHub token is required for the first connection.');
  const provider = input.token
    ? new GitHubProvider(input.token)
    : existing
      ? providerFor(existing)
      : (() => {
          throw badRequest('A fine-grained GitHub token is required for the first connection.');
        })();
  await provider.verifyWriteAccess(repository);
  const [baseSha, headSha] = await Promise.all([provider.getBranchSha(repository, baseBranch), provider.getBranchSha(repository, headBranch)]);
  if (!baseSha) throw badRequest(`Base branch ${baseBranch} was not found.`);
  const baselineRef = headSha ?? baseSha;
  const files = provider.listThemeRepositoryFiles
    ? await provider.listThemeRepositoryFiles(repository, baselineRef, contentPath)
    : await provider.listMarkdownFiles(repository, baselineRef, contentPath);
  const snapshot = await getCurrentSnapshot(projectId);
  const repositoryIssues = remoteThemeRepositoryIssues(files, snapshot, contentPath);
  if (repositoryIssues.length > 0) {
    throw badRequest(`Theme repository validation failed: ${repositoryIssues.map((issue) => issue.message).join(' ')}`);
  }
  const generatedSecret = existing?.webhookSecretEncrypted ? null : randomBytes(32).toString('hex');
  const connection = await prisma.gitConnection.upsert({
    where: { projectId },
    create: {
      projectId,
      provider: 'github',
      repository,
      baseBranch,
      headBranch,
      contentPath,
      importBranchId: input.importBranchId || null,
      importLanguageId: input.importLanguageId || null,
      credentialEncrypted: encryptGitSecret(input.token as string),
      credentialFingerprint: gitCredentialFingerprint(input.token as string),
      webhookSecretEncrypted: encryptGitSecret(generatedSecret as string),
      remoteBaseSha: baseSha,
      remoteHeadSha: headSha,
      createdById: actorUserId,
    },
    update: {
      repository,
      baseBranch,
      headBranch,
      contentPath,
      importBranchId: input.importBranchId || null,
      importLanguageId: input.importLanguageId || null,
      remoteBaseSha: baseSha,
      remoteHeadSha: headSha,
      ...(input.token ? { credentialEncrypted: encryptGitSecret(input.token), credentialFingerprint: gitCredentialFingerprint(input.token) } : {}),
    },
  });
  const topologyChanged = Boolean(
    existing &&
      (existing.repository !== repository ||
        existing.baseBranch !== baseBranch ||
        existing.headBranch !== headBranch ||
        existing.contentPath !== contentPath ||
        existing.importBranchId !== (input.importBranchId || null) ||
        existing.importLanguageId !== (input.importLanguageId || null)),
  );
  if (topologyChanged) await prisma.gitFileState.deleteMany({ where: { connectionId: connection.id } });
  await initializeFileStates(connection, files);
  await audit(connection, actorUserId, existing ? 'connection.updated' : 'connection.created', {
    provider: 'github',
    repository,
    baseBranch,
    headBranch,
    credentialRotated: Boolean(input.token && existing),
  });
  return { connection: redactConnection(connection), webhookSecret: generatedSecret };
};

/** Verify the provider identity before repository configuration is exposed.
 * The credential is held only for this request and is never persisted here. */
export const authorizeGitHub = async (token: string) => new GitHubProvider(token).verifyIdentity();

const redactConnection = <T extends { credentialEncrypted: string | null; webhookSecretEncrypted: string | null }>(connection: T) => {
  const { credentialEncrypted: _credential, webhookSecretEncrypted: _webhook, ...safe } = connection;
  return { ...safe, credentialConfigured: Boolean(connection.credentialEncrypted), webhookConfigured: Boolean(connection.webhookSecretEncrypted) };
};

export const rotateConnectionWebhookSecret = async (projectId: string, actorUserId: string): Promise<string> => {
  const connection = await prisma.gitConnection.findUnique({ where: { projectId } });
  if (!connection) throw notFound('git connection', { projectId });
  const secret = randomBytes(32).toString('hex');
  await prisma.gitConnection.update({ where: { id: connection.id }, data: { webhookSecretEncrypted: encryptGitSecret(secret) } });
  await audit(connection, actorUserId, 'webhook.secret_rotated');
  return secret;
};

export const getConnectionWebhookSecret = (connection: { webhookSecretEncrypted: string | null }): string | null =>
  connection.webhookSecretEncrypted ? decryptGitSecret(connection.webhookSecretEncrypted) : null;

export const queueGitOperation = async (projectId: string, actorUserId: string | null, input: QueueGitInput) => {
  const connection = await prisma.gitConnection.findUnique({ where: { projectId } });
  if (!connection) throw notFound('git connection', { projectId });
  if (!/^[A-Za-z0-9._-]{8,160}$/.test(input.idempotencyKey)) throw badRequest('Provide an idempotency key between 8 and 160 safe characters.');
  if (input.kind === 'PUSH') {
    if (!input.commitMessage?.trim()) throw badRequest('A commit message is required.');
    if (!(input.authorName?.trim() && input.authorEmail?.trim())) throw badRequest('Commit author name and email are required.');
  }
  const hash = requestHash(input);
  const existing = await prisma.gitSyncOperation.findUnique({
    where: { connectionId_idempotencyKey: { connectionId: connection.id, idempotencyKey: input.idempotencyKey } },
    include: { conflicts: true },
  });
  if (existing) {
    if (existing.requestHash !== hash) throw badRequest('This idempotency key was already used with a different request.');
    if (!['SUCCEEDED', 'RUNNING'].includes(existing.status)) {
      await createJob(
        QueueNames.GIT,
        { name: 'process-git-operation', data: { operationId: existing.id } },
        { jobId: `${existing.id}-retry-${Date.now()}` },
      );
    }
    return existing;
  }
  const operation = await prisma.gitSyncOperation.create({
    data: {
      connectionId: connection.id,
      kind: input.kind,
      status: 'QUEUED',
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
      requestedById: actorUserId,
      baseBranch: connection.baseBranch,
      headBranch: connection.headBranch,
      commitMessage: input.commitMessage?.trim(),
      authorName: input.authorName?.trim(),
      authorEmail: input.authorEmail?.trim(),
      request: input as unknown as Prisma.InputJsonValue,
    },
  });
  await createJob(QueueNames.GIT, { name: 'process-git-operation', data: { operationId: operation.id } }, { jobId: operation.id });
  await prisma.gitConnection.update({ where: { id: connection.id }, data: { lastSyncStatus: 'QUEUED', lastSyncError: null } });
  await audit(connection, actorUserId, `operation.${input.kind.toLowerCase()}.queued`, { operationId: operation.id });
  return operation;
};

type MergeEntry = {
  path: string;
  base: string | null;
  ours: string | null;
  theirs: string | null;
  pageId: string | null;
  ownership: ThemeRepositoryOwnership;
};

const valueEqual = (a: string | null, b: string | null): boolean => a === b;
const mergeEntries = (
  states: Array<{ path: string; baseContent: string | null; baseExists: boolean; pageId: string | null; ownership: string }>,
  ours: Map<string, LocalRepositoryFile>,
  theirs: Map<string, RemoteFile>,
  contentPath: string,
  pageIdByPath: ReadonlyMap<string, string>,
): MergeEntry[] => {
  const paths = new Set([...states.map((state) => state.path), ...ours.keys(), ...theirs.keys()]);
  const stateByPath = new Map(states.map((state) => [state.path, state]));
  return [...paths].sort().map((path) => {
    const state = stateByPath.get(path);
    const ownership =
      (state?.ownership as ThemeRepositoryOwnership | undefined) ??
      ours.get(path)?.ownership ??
      themeRepositoryOwnershipForPath(path, contentPath) ??
      'SHARED';
    const localContent = ours.get(path)?.content ?? null;
    return {
      path,
      base: state?.baseExists ? state.baseContent : null,
      // Once customer code has a ledger row, Nibleaf's newer scaffold is not
      // an authoring input. Preserve the recorded Git base, including a
      // tombstoned deletion, so a later push cannot resurrect the file.
      ours: repositoryOurs(ownership, state, localContent),
      theirs: theirs.get(path)?.content ?? null,
      pageId: pageIdByPath.get(path) ?? ours.get(path)?.page?.id ?? state?.pageId ?? null,
      ownership,
    };
  });
};

const hasConflict = (entry: MergeEntry): boolean => reconcileOwnedFile(entry.ownership, entry.base, entry.ours, entry.theirs).conflict;

const chosenContent = (entry: MergeEntry): string | null => reconcileOwnedFile(entry.ownership, entry.base, entry.ours, entry.theirs).content;

const changedFileSummary = (entries: MergeEntry[], target: Map<string, string | null>, compare: 'ours' | 'theirs') =>
  entries
    .filter((entry) => !valueEqual(target.get(entry.path) ?? null, entry[compare]))
    .map((entry) => ({
      path: entry.path,
      status: entry[compare] === null ? 'added' : target.get(entry.path) === null ? 'deleted' : 'modified',
    }));

const previewSnapshot = (connection: { projectId: string }) => getCurrentSnapshot(connection.projectId);

const upsertPreview = async (
  connection: { id: string; projectId: string; importBranchId: string | null },
  sourceSha: string,
  pullRequest: { id: string } | null,
) => {
  const existing = await prisma.gitPreview.findUnique({ where: { connectionId_sourceSha: { connectionId: connection.id, sourceSha } } });
  if (existing?.status === 'READY') return existing;
  const preview =
    existing ??
    (await prisma.gitPreview.create({
      data: { projectId: connection.projectId, connectionId: connection.id, pullRequestId: pullRequest?.id, sourceSha, token: previewToken() },
    }));
  try {
    await prisma.gitPreview.update({ where: { id: preview.id }, data: { status: 'BUILDING', startedAt: new Date(), error: null } });
    const snapshot = await previewSnapshot(connection);
    const url = `/git-preview/${preview.token}`;
    return await prisma.gitPreview.update({
      where: { id: preview.id },
      data: { status: 'READY', snapshot: snapshot as unknown as Prisma.InputJsonValue, url, completedAt: new Date() },
    });
  } catch (error) {
    await prisma.gitPreview.update({
      where: { id: preview.id },
      data: { status: 'FAILED', error: (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR), completedAt: new Date() },
    });
    throw error;
  }
};

const upsertPullRequest = async (
  operation: { id: string; request: unknown; commitMessage: string | null; headBranch: string; baseBranch: string },
  connection: { id: string; projectId: string; repository: string; importBranchId: string | null },
  provider: GitProviderClient,
  sha: string,
  changes: Array<{ path: string; status: string }>,
) => {
  const request = (operation.request ?? {}) as unknown as QueueGitInput;
  if (request.createPullRequest !== true) return null;
  const body = [
    request.pullRequestBody?.trim() || 'Draft documentation changes authored in Nibleaf.',
    '',
    '### Changed files',
    ...changes.map((file) => `- \`${file.path}\` — ${file.status}`),
    '',
    `_Idempotent Nibleaf operation: ${operation.id}_`,
  ].join('\n');
  const remote = await provider.upsertDraftPullRequest({
    repository: connection.repository,
    baseBranch: operation.baseBranch,
    headBranch: operation.headBranch,
    title: request.pullRequestTitle?.trim() || operation.commitMessage || 'Update documentation',
    body,
  });
  return prisma.gitPullRequest.upsert({
    where: { connectionId_number: { connectionId: connection.id, number: remote.number } },
    create: {
      connectionId: connection.id,
      number: remote.number,
      url: remote.url,
      title: remote.title,
      state: remote.state,
      draft: remote.draft,
      baseBranch: remote.baseBranch,
      headBranch: remote.headBranch,
      headSha: remote.headSha || sha,
    },
    update: {
      url: remote.url,
      title: remote.title,
      state: remote.state,
      draft: remote.draft,
      baseBranch: remote.baseBranch,
      headSha: remote.headSha || sha,
      lastSyncedAt: new Date(),
    },
  });
};

/** How many times one operation re-runs itself because pages changed under it. */
const MAX_EDIT_REQUEUES = 3;
const EDIT_REQUEUE_BASE_DELAY_MS = 5000;

/**
 * The apply rolled back because pages changed after the merge read them.
 * Re-read those pages and record conflicts for the writer where they now
 * really conflict with Git; otherwise run the operation again, with
 * backoff and a small cap so a constantly edited page cannot loop it against
 * the provider. A PUSH that already updated the remote branch forgets its
 * commit, so the next run commits only what is still new.
 */
const surfaceConcurrentEdits = async (
  operation: { id: string; kind: string; requestedById: string | null },
  connection: { id: string; projectId: string; contentPath: string; importBranchId: string | null; importLanguageId: string | null },
  entries: MergeEntry[],
  paths: string[],
  remoteBranchUpdated: boolean,
): Promise<void> => {
  const fresh = await localFiles(connection);
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const conflicted = paths.flatMap((path) => {
    const entry = entryByPath.get(path);
    if (!entry) return [];
    const current = { ...entry, ours: fresh.files.get(path)?.content ?? null };
    return hasConflict(current) ? [current] : [];
  });
  const forgetCommit = remoteBranchUpdated ? { remoteSha: null } : {};
  if (conflicted.length === 0) {
    const requeues = await prisma.gitAuditEvent.count({
      where: { connectionId: connection.id, action: 'operation.requeued_after_edit', metadata: { path: ['operationId'], equals: operation.id } },
    });
    if (requeues >= MAX_EDIT_REQUEUES) {
      throw new Error(
        `Git sync stopped after ${MAX_EDIT_REQUEUES} tries because pages kept changing while it ran. Nothing was changed in Nibleaf; run the sync again.`,
      );
    }
    await prisma.$transaction([
      prisma.gitSyncOperation.update({ where: { id: operation.id }, data: { status: 'QUEUED', completedAt: null, ...forgetCommit } }),
      prisma.gitConnection.update({ where: { id: connection.id }, data: { lastSyncStatus: 'QUEUED', lastSyncError: null } }),
    ]);
    await createJob(
      QueueNames.GIT,
      { name: 'process-git-operation', data: { operationId: operation.id } },
      { jobId: `${operation.id}-edited-${requeues + 1}`, delay: EDIT_REQUEUE_BASE_DELAY_MS * 2 ** requeues },
    );
    await audit(connection, operation.requestedById, 'operation.requeued_after_edit', {
      operationId: operation.id,
      files: paths.length,
      attempt: requeues + 1,
    });
    return;
  }
  const snapshot = (entry: MergeEntry) => ({ baseContent: entry.base, oursContent: entry.ours, theirsContent: entry.theirs });
  await prisma.$transaction([
    ...conflicted.map((entry) =>
      prisma.gitConflict.upsert({
        where: { operationId_path: { operationId: operation.id, path: entry.path } },
        create: { operationId: operation.id, path: entry.path, ...snapshot(entry) },
        update: { ...snapshot(entry), status: 'OPEN', resolution: null, resolvedContent: null, resolvedById: null, resolvedAt: null },
      }),
    ),
    prisma.gitSyncOperation.update({ where: { id: operation.id }, data: { status: 'CONFLICT', completedAt: null, ...forgetCommit } }),
    prisma.gitConnection.update({ where: { id: connection.id }, data: { lastSyncStatus: 'CONFLICT', lastSyncError: null } }),
  ]);
  await audit(connection, operation.requestedById, 'operation.conflict_detected', {
    operationId: operation.id,
    files: conflicted.length,
    reason: 'edited_during_sync',
  });
};

const markFailed = async (operationId: string, connectionId: string, error: unknown): Promise<never> => {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR);
  await prisma.$transaction([
    prisma.gitSyncOperation.update({ where: { id: operationId }, data: { status: 'FAILED', error: message, completedAt: new Date() } }),
    prisma.gitConnection.update({ where: { id: connectionId }, data: { lastSyncStatus: 'FAILED', lastSyncError: message } }),
  ]);
  throw error;
};

class GitOperationBusyError extends Error {
  constructor(connectionId: string) {
    super(`Another Git operation is already running for connection ${connectionId}.`);
    this.name = 'GitOperationBusyError';
  }
}

const isSerializationFailure = (error: unknown) => z.object({ code: z.literal('P2034') }).safeParse(error).success;

/**
 * Claim one operation while holding a serializable transaction on its
 * connection. The RUNNING row is the durable mutex: PostgreSQL aborts one side
 * of concurrent write-skew claims, while a sufficiently old row can be
 * recovered after the API or worker process disappears mid-operation.
 */
const claimGitOperation = async (operationId: string) => {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const operation = await tx.gitSyncOperation.findUnique({
          where: { id: operationId },
          include: { connection: true, conflicts: true },
        });
        if (!operation) throw notFound('git operation', { id: operationId });
        if (operation.status === 'SUCCEEDED') return null;

        const now = new Date();
        const staleBefore = new Date(now.getTime() - GIT_OPERATION_CLAIM_TIMEOUT);
        const active = await tx.gitSyncOperation.findFirst({
          where: { connectionId: operation.connectionId, status: 'RUNNING', id: { not: operation.id } },
          select: { id: true, startedAt: true },
        });
        if (active) {
          if (active.startedAt && active.startedAt > staleBefore) {
            throw new GitOperationBusyError(operation.connectionId);
          }
          const released = await tx.gitSyncOperation.updateMany({
            where: {
              id: active.id,
              status: 'RUNNING',
              ...(active.startedAt ? { startedAt: { lte: staleBefore } } : { startedAt: null }),
            },
            data: {
              status: 'FAILED',
              error: 'Git operation was interrupted before completion and can be retried safely.',
              completedAt: now,
            },
          });
          if (released.count !== 1) throw new GitOperationBusyError(operation.connectionId);
        }

        if (operation.status === 'RUNNING' && operation.startedAt && operation.startedAt > staleBefore) {
          throw new GitOperationBusyError(operation.connectionId);
        }
        const claimed = await tx.gitSyncOperation.updateMany({
          where: {
            id: operation.id,
            status: operation.status,
            ...(operation.startedAt ? { startedAt: operation.startedAt } : { startedAt: null }),
          },
          data: { status: 'RUNNING', startedAt: operation.startedAt ?? now, completedAt: null, error: null },
        });
        if (claimed.count !== 1) throw new GitOperationBusyError(operation.connectionId);
        await tx.gitConnection.update({
          where: { id: operation.connectionId },
          data: { lastSyncStatus: 'RUNNING', lastSyncError: null },
        });
        return { ...operation, status: 'RUNNING', startedAt: operation.startedAt ?? now, completedAt: null, error: null };
      },
      { isolationLevel: 'Serializable' },
    );
  } catch (error) {
    if (isSerializationFailure(error)) throw new GitOperationBusyError(operationId);
    throw error;
  }
};

export const processGitOperation = async (operationId: string): Promise<void> => {
  const operation = await claimGitOperation(operationId);
  if (!operation) return;
  const connection = operation.connection;
  try {
    const provider = providerFor(connection);
    const request = (operation.request ?? {}) as unknown as QueueGitInput;
    const sourceBranch =
      operation.kind === 'PULL' && request.sourceRef ? normalizeGitBranch(request.sourceRef, 'Source branch') : operation.headBranch;
    const baseSha = await provider.getBranchSha(connection.repository, operation.baseBranch);
    const headSha = await provider.getBranchSha(connection.repository, sourceBranch);
    if (!baseSha) throw new Error(`Base branch ${operation.baseBranch} no longer exists.`);
    const remoteSha = operation.kind === 'PULL' && request.sourceSha ? request.sourceSha : (headSha ?? baseSha);
    const [remoteFiles, local, states] = await Promise.all([
      provider.listThemeRepositoryFiles
        ? provider.listThemeRepositoryFiles(connection.repository, remoteSha, connection.contentPath)
        : provider.listMarkdownFiles(connection.repository, remoteSha, connection.contentPath),
      localFiles(connection),
      prisma.gitFileState.findMany({ where: { connectionId: connection.id } }),
    ]);
    const ours = local.files;
    const theirs = new Map(remoteFiles.map((file) => [file.path, file]));
    const repositoryIssues = remoteThemeRepositoryIssues(remoteFiles, local.snapshot, connection.contentPath);
    const fatalRepositoryIssues = repositoryIssues.filter((issue) => issue.code !== 'PLATFORM_FILE_MODIFIED');
    if (fatalRepositoryIssues.length > 0) {
      throw new Error(`Theme repository validation failed: ${fatalRepositoryIssues.map((issue) => issue.message).join(' ')}`);
    }
    const entries = mergeEntries(states, ours, theirs, connection.contentPath, local.pageIdByPath);
    const existingConflicts = new Map(operation.conflicts.map((conflict) => [conflict.path, conflict]));
    const staleResolutions = entries.flatMap((entry) => {
      const conflict = existingConflicts.get(entry.path);
      return conflict?.status === 'RESOLVED' && !conflictSnapshotMatches(conflict, entry) ? [{ entry, conflict }] : [];
    });
    if (staleResolutions.length > 0) {
      await prisma.$transaction(
        staleResolutions.map(({ entry, conflict }) =>
          prisma.gitConflict.update({
            where: { id: conflict.id },
            data: {
              baseContent: entry.base,
              oursContent: entry.ours,
              theirsContent: entry.theirs,
              status: hasConflict(entry) ? 'OPEN' : 'SUPERSEDED',
              resolution: null,
              resolvedContent: null,
              resolvedById: null,
              resolvedAt: null,
            },
          }),
        ),
      );
    }
    const newConflicts = entries.filter(hasConflict).filter((entry) => !existingConflicts.has(entry.path));
    if (newConflicts.length > 0) {
      await prisma.gitConflict.createMany({
        data: newConflicts.map((entry) => ({
          operationId: operation.id,
          path: entry.path,
          baseContent: entry.base,
          oursContent: entry.ours,
          theirsContent: entry.theirs,
        })),
        skipDuplicates: true,
      });
    }
    const conflicts = await prisma.gitConflict.findMany({ where: { operationId: operation.id } });
    if (conflicts.some((conflict) => conflict.status === 'OPEN')) {
      await prisma.$transaction([
        prisma.gitSyncOperation.update({ where: { id: operation.id }, data: { status: 'CONFLICT', completedAt: null } }),
        prisma.gitConnection.update({ where: { id: connection.id }, data: { lastSyncStatus: 'CONFLICT', lastSyncError: null } }),
      ]);
      await audit(connection, operation.requestedById, 'operation.conflict_detected', { operationId, files: conflicts.length });
      return;
    }
    const resolved = new Map(
      conflicts.filter((conflict) => conflict.status === 'RESOLVED').map((conflict) => [conflict.path, conflict.resolvedContent]),
    );
    const target = new Map(
      entries.map((entry) => [entry.path, resolved.has(entry.path) ? (resolved.get(entry.path) ?? null) : chosenContent(entry)]),
    );
    const changes = changedFileSummary(entries, target, operation.kind === 'PUSH' ? 'theirs' : 'ours');
    let finalSha = remoteSha;

    if (operation.kind === 'PUSH' && changes.length > 0) {
      if (sourceBranch !== operation.headBranch) throw new Error('Push operations cannot target a webhook source branch.');
      const commitSha =
        operation.remoteSha ??
        (await provider.createCommit({
          repository: connection.repository,
          baseSha: remoteSha,
          branch: operation.headBranch,
          message: operation.commitMessage as string,
          author: { name: operation.authorName as string, email: operation.authorEmail as string },
          files: changes.map((change) => ({ path: change.path, content: target.get(change.path) ?? null })),
        }));
      if (!operation.remoteSha) await prisma.gitSyncOperation.update({ where: { id: operation.id }, data: { remoteSha: commitSha } });
      if (headSha) await provider.updateBranch(connection.repository, operation.headBranch, commitSha, headSha);
      else await provider.createBranch(connection.repository, operation.headBranch, commitSha);
      finalSha = commitSha;
    }

    // Apply the merged target only after conflict-free reconciliation. For PULL,
    // this imports upstream-only changes; for PUSH, it also adopts safe upstream
    // edits that arrived while Nibleaf changed different files. Page writes and
    // the file ledger commit in ONE transaction: a failing file leaves every
    // page and the baseline exactly as they were, and a page saved after the
    // merge read makes the whole apply roll back instead of being overwritten.
    const contentChanges = entries.flatMap((entry): GitContentChange[] => {
      const desired = target.get(entry.path) ?? null;
      if (entry.ownership !== 'SHARED' || valueEqual(desired, entry.ours)) return [];
      if (desired === null) {
        return entry.pageId ? [{ type: 'delete', path: entry.path, pageId: entry.pageId }] : [];
      }
      return [{ type: 'write', path: entry.path, pageId: entry.pageId, content: desired }];
    });
    const { branch: authoringBranch, language: authoringLanguage } =
      contentChanges.length > 0 ? await authoringContext(connection) : { branch: null, language: null };

    const baseline = operation.kind === 'PUSH' ? target : new Map(entries.map((entry) => [entry.path, entry.theirs]));
    const stateByPath = new Map(states.map((state) => [state.path, state]));
    const applyAndRecordBaseline = async (tx: Prisma.TransactionClient) => {
      const applied =
        authoringBranch && authoringLanguage
          ? await applyGitContentChanges(
              tx,
              {
                projectId: connection.projectId,
                contentPath: connection.contentPath,
                branch: authoringBranch,
                language: authoringLanguage,
                snapshot: local.snapshot,
                observed: local.observed,
              },
              contentChanges,
            )
          : new Map<string, string | null>();
      // Only ledger rows whose recorded base or page link actually changes are
      // written, so a large, mostly unchanged repository keeps the transaction
      // (and the project lock it may hold) short.
      const removed: string[] = [];
      const created: Prisma.GitFileStateCreateManyInput[] = [];
      // A ledger row never keeps a link to a page that no longer exists
      // (removed with its parent, or deleted in the dashboard since).
      const linked = [...new Set(entries.flatMap((entry) => (applied.has(entry.path) ? [] : entry.pageId ? [entry.pageId] : [])))];
      const existing = new Set(
        linked.length > 0 ? (await tx.page.findMany({ where: { id: { in: linked } }, select: { id: true } })).map((page) => page.id) : [],
      );
      for (const entry of entries) {
        const content = baseline.get(entry.path) ?? null;
        const pageId = applied.has(entry.path) ? (applied.get(entry.path) ?? null) : entry.pageId && existing.has(entry.pageId) ? entry.pageId : null;
        const state = stateByPath.get(entry.path);
        if (operation.kind === 'PULL' && entry.ownership === 'CUSTOMER' && !state && entry.theirs === null) {
          // A pull before the initial scaffold push must not turn a missing
          // customer file into a durable deletion. Leaving the ledger absent
          // lets the next push seed the generated starter exactly once.
          continue;
        }
        if (entry.ownership === 'SHARED' && content === null && (target.get(entry.path) ?? null) === null) {
          if (state) removed.push(entry.path);
          continue;
        }
        const next = { ownership: entry.ownership, pageId, baseContent: content, baseExists: content !== null };
        if (!state) {
          created.push({
            connectionId: connection.id,
            path: entry.path,
            branchId: connection.importBranchId,
            languageId: connection.importLanguageId,
            ...next,
          });
          continue;
        }
        const unchanged =
          state.ownership === next.ownership &&
          state.pageId === next.pageId &&
          state.baseExists === next.baseExists &&
          (state.baseExists ? state.baseContent : null) === next.baseContent;
        if (!unchanged) {
          await tx.gitFileState.update({ where: { connectionId_path: { connectionId: connection.id, path: entry.path } }, data: next });
        }
      }
      if (removed.length > 0) await tx.gitFileState.deleteMany({ where: { connectionId: connection.id, path: { in: removed } } });
      if (created.length > 0) await tx.gitFileState.createMany({ data: created });
    };
    try {
      await prisma.$transaction(applyAndRecordBaseline, GIT_APPLY_TRANSACTION);
    } catch (error) {
      if (error instanceof GitApplyConflictError) {
        await surfaceConcurrentEdits(operation, connection, entries, error.paths, operation.kind === 'PUSH' && changes.length > 0);
        return;
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Git sync failed and nothing was changed in Nibleaf. ${detail}`, { cause: error });
    }

    let pull = operation.kind === 'PUSH' ? await upsertPullRequest(operation, connection, provider, finalSha, changes) : null;
    if (operation.kind === 'PULL' && request.pullRequestNumber) {
      const remotePull: RemotePullRequest = await provider.getPullRequest(connection.repository, request.pullRequestNumber);
      pull = await prisma.gitPullRequest.upsert({
        where: { connectionId_number: { connectionId: connection.id, number: remotePull.number } },
        create: {
          connectionId: connection.id,
          number: remotePull.number,
          url: remotePull.url,
          title: remotePull.title,
          state: remotePull.state,
          draft: remotePull.draft,
          baseBranch: remotePull.baseBranch,
          headBranch: remotePull.headBranch,
          headSha: remotePull.headSha,
        },
        update: {
          url: remotePull.url,
          title: remotePull.title,
          state: remotePull.state,
          draft: remotePull.draft,
          baseBranch: remotePull.baseBranch,
          headBranch: remotePull.headBranch,
          headSha: remotePull.headSha,
          lastSyncedAt: new Date(),
        },
      });
      finalSha = remotePull.headSha;
    }
    const preview = pull ? await upsertPreview(connection, finalSha, pull) : null;
    if (operation.kind === 'PUSH' && pull && preview?.url) {
      const requestBody = (operation.request ?? {}) as unknown as QueueGitInput;
      const previewUrl = `${env.APP_URL.replace(/\/$/, '')}${preview.url}`;
      await provider.upsertDraftPullRequest({
        repository: connection.repository,
        baseBranch: operation.baseBranch,
        headBranch: operation.headBranch,
        title: requestBody.pullRequestTitle?.trim() || operation.commitMessage || 'Update documentation',
        body: [
          requestBody.pullRequestBody?.trim() || 'Draft documentation changes authored in Nibleaf.',
          '',
          `Preview: ${previewUrl}`,
          '',
          '### Changed files',
          ...changes.map((file) => `- \`${file.path}\` — ${file.status}`),
          '',
          `_Idempotent Nibleaf operation: ${operation.id}_`,
        ].join('\n'),
      });
    }
    await prisma.$transaction([
      prisma.gitSyncOperation.update({
        where: { id: operation.id },
        data: {
          status: 'SUCCEEDED',
          changedFiles: changes as unknown as Prisma.InputJsonValue,
          remoteSha: finalSha,
          pullRequestNo: pull?.number,
          pullRequestUrl: pull?.url,
          error: null,
          completedAt: new Date(),
        },
      }),
      prisma.gitConnection.update({
        where: { id: connection.id },
        data: {
          remoteBaseSha: baseSha,
          remoteHeadSha: operation.kind === 'PUSH' ? finalSha : connection.remoteHeadSha,
          lastSyncStatus: 'SUCCEEDED',
          lastSyncError: null,
          lastSyncedAt: new Date(),
        },
      }),
    ]);
    await audit(connection, operation.requestedById, `operation.${operation.kind.toLowerCase()}.succeeded`, {
      operationId,
      changedFiles: changes.length,
      commitSha: finalSha,
      pullRequest: pull?.number,
      previewId: preview?.id,
    });
    if (operation.idempotencyKey.startsWith('webhook-')) {
      await prisma.gitWebhookDelivery.updateMany({
        where: { connectionId: connection.id, providerDeliveryId: operation.idempotencyKey.slice('webhook-'.length) },
        data: { status: 'PROCESSED', processedAt: new Date(), error: null },
      });
    }
  } catch (error) {
    if (operation.idempotencyKey.startsWith('webhook-')) {
      await prisma.gitWebhookDelivery.updateMany({
        where: { connectionId: connection.id, providerDeliveryId: operation.idempotencyKey.slice('webhook-'.length) },
        data: { status: 'FAILED', error: (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR), processedAt: new Date() },
      });
    }
    await markFailed(operation.id, connection.id, error);
  }
};

export const resolveGitConflict = async (
  projectId: string,
  conflictId: string,
  actorUserId: string,
  resolution: 'OURS' | 'THEIRS' | 'CUSTOM',
  customContent?: string | null,
) => {
  const conflict = await prisma.gitConflict.findFirst({
    where: { id: conflictId, operation: { connection: { projectId } } },
    include: { operation: { include: { connection: true } } },
  });
  if (!conflict) throw notFound('git conflict', { id: conflictId });
  if (conflict.status !== 'OPEN') return conflict;
  if (resolution === 'CUSTOM' && customContent === undefined) throw badRequest('Custom resolution content is required. Use null to delete the file.');
  const resolvedContent = resolution === 'OURS' ? conflict.oursContent : resolution === 'THEIRS' ? conflict.theirsContent : (customContent ?? null);
  const updated = await prisma.gitConflict.update({
    where: { id: conflict.id },
    data: { status: 'RESOLVED', resolution, resolvedContent, resolvedById: actorUserId, resolvedAt: new Date() },
  });
  await audit(conflict.operation.connection, actorUserId, 'conflict.resolved', {
    operationId: conflict.operationId,
    path: conflict.path,
    resolution,
  });
  const remaining = await prisma.gitConflict.count({ where: { operationId: conflict.operationId, status: 'OPEN' } });
  if (remaining === 0) {
    await prisma.gitSyncOperation.update({ where: { id: conflict.operationId }, data: { status: 'QUEUED' } });
    await createJob(
      QueueNames.GIT,
      { name: 'process-git-operation', data: { operationId: conflict.operationId } },
      { jobId: `${conflict.operationId}-resolved` },
    );
  }
  return updated;
};

export const getGitWorkspaceStatus = async (projectId: string) => {
  const connection = await prisma.gitConnection.findUnique({
    where: { projectId },
    include: {
      operations: { orderBy: { createdAt: 'desc' }, take: 20, include: { conflicts: { orderBy: { path: 'asc' } } } },
      pullRequests: { orderBy: { updatedAt: 'desc' }, take: 10, include: { previews: { orderBy: { createdAt: 'desc' }, take: 1 } } },
      files: { orderBy: { path: 'asc' }, select: { path: true, pageId: true, updatedAt: true } },
      auditEvents: { orderBy: { createdAt: 'desc' }, take: 30 },
    },
  });
  return connection ? redactConnection(connection) : null;
};

export const getReadyGitPreview = async (token: string) => {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) throw notFound('git preview');
  const preview = await prisma.gitPreview.findUnique({ where: { token }, select: { status: true, snapshot: true, completedAt: true } });
  if (preview?.status !== 'READY' || !preview.snapshot) throw notFound('git preview');
  return preview;
};

export const recordWebhookDelivery = async (input: {
  connectionId: string;
  deliveryId: string;
  event: string;
  rawBody: string;
}): Promise<{ duplicate: boolean; id: string }> => {
  const hash = payloadHash(input.rawBody);
  const existing = await prisma.gitWebhookDelivery.findUnique({
    where: { connectionId_providerDeliveryId: { connectionId: input.connectionId, providerDeliveryId: input.deliveryId } },
  });
  if (existing) {
    if (existing.payloadHash !== hash) throw badRequest('Webhook delivery id was reused with a different payload.');
    return { duplicate: true, id: existing.id };
  }
  const delivery = await prisma.gitWebhookDelivery.create({
    data: { connectionId: input.connectionId, providerDeliveryId: input.deliveryId, event: input.event, payloadHash: hash },
  });
  return { duplicate: false, id: delivery.id };
};
