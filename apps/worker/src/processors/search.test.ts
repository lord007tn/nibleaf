import type { ReindexProjectJobData } from '@nibleaf/bullmq/jobs/search';
import type { QdrantFilter, QdrantIndexedPoint, QdrantPoint } from '@nibleaf/qdrant';
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

type RunStatus = 'PENDING' | 'RUNNING' | 'READY' | 'FAILED' | 'DISABLED';
const runStatusSchema = z.enum(['PENDING', 'RUNNING', 'READY', 'FAILED', 'DISABLED']);
interface SearchRunState {
  id: string;
  projectId: string;
  deploymentId: string;
  jobId: string | null;
  status: RunStatus;
  claimToken: string | null;
  claimExpiresAt: Date | null;
  startedAt: Date | null;
  completedAt?: Date | null;
  updatedAt: Date;
  indexedChunks: number;
  embeddedChunks: number;
  reusedChunks: number;
  unchangedChunks: number;
  metadataUpdatedChunks: number;
  deletedChunks: number;
  attempt: number;
  expectedChunks?: number;
  expectedPages?: number;
  indexedPages?: number;
  staleChunks?: number;
  failedChunks?: number;
  errorCode?: string | null;
  issueSample?: unknown;
  logicalIndexId?: string;
  schemaVersion?: string;
  revisionId?: string;
  embeddingModel?: string;
  vectorSize?: number;
}

type SearchRunWhere = Partial<Pick<SearchRunState, 'id' | 'projectId' | 'deploymentId' | 'jobId' | 'claimToken' | 'updatedAt'>> & {
  status?: RunStatus | { in: RunStatus[] };
};
type SearchRunCreate = Partial<SearchRunState> & Pick<SearchRunState, 'projectId' | 'deploymentId'>;
type SearchRunUpdate = Partial<Omit<SearchRunState, 'attempt'>> & { attempt?: { increment: number } };
const runStatusFilterSchema = z.object({ in: z.array(runStatusSchema) }).strict();

const mocks = vi.hoisted(() => ({
  apiKey: 'embedding-key' as string | undefined,
  loseDisabledClaim: false,
  accessMode: 'READERS' as 'PUBLIC' | 'WORKSPACE' | 'READERS',
  currentPoints: [] as QdrantIndexedPoint[],
  previousPoints: [] as QdrantIndexedPoint[],
  previousDeployment: null as { id: string } | null,
  runs: [] as SearchRunState[],
  deployment: {
    id: 'deployment-a',
    version: 2,
    snapshot: {
      project: { versions: [{ id: 'version-main', slug: 'main' }] },
      pages: [
        {
          id: 'page-ar',
          versionId: 'version-main',
          kind: 'PAGE',
          hidden: false,
          config: null,
          title: 'الإعداد',
          path: 'ar/setup',
          description: 'دليل عربي',
          content: '## التثبيت\n\nشغّل `pnpm dev` من جذر المشروع.',
          icon: null,
          languageCode: 'ar',
        },
        {
          id: 'page-hidden',
          versionId: 'version-main',
          kind: 'PAGE',
          hidden: true,
          config: null,
          title: 'Secret',
          path: 'secret',
          description: '',
          content: 'Never index me.',
          icon: null,
          languageCode: 'en',
        },
      ],
    },
  },
  ensureHybridCollection: vi.fn(async () => ({ alias: 'active', collection: 'physical', created: false })),
  upsert: vi.fn(async (_points: QdrantPoint[]) => undefined),
  replacePayload: vi.fn(async (_id: string | number, _payload: Record<string, unknown>, _filter: QdrantFilter) => undefined),
  deletePoints: vi.fn(async (_ids: Array<string | number>, _filter: QdrantFilter) => undefined),
  deleteByFilterAllVersions: vi.fn(async (_filter: QdrantFilter) => 1),
  embed: vi.fn(async (inputs: string[]) => ({ vectors: inputs.map(() => [0.1, 0.2]), model: 'test' })),
  insertUsageEvents: vi.fn(async (_events: unknown[]) => undefined),
  markUsageStorageWritten: vi.fn(async (_organizationId: string) => undefined),
}));

const deploymentIdFrom = (filter: QdrantFilter) => {
  for (const condition of filter.must) {
    if ('key' in condition && condition.key === 'deployment_id') return condition.match.value;
  }
};

const listIndexedPoints = vi.fn(async (filter: QdrantFilter, includeVectors = false) => {
  const deploymentId = deploymentIdFrom(filter);
  if (deploymentId === 'deployment-old') return includeVectors ? mocks.previousPoints : [];
  return mocks.currentPoints;
});

vi.mock('../env', () => ({
  env: {
    get OPENROUTER_API_KEY() {
      return mocks.apiKey;
    },
    APP_URL: 'https://nibleaf.test',
    SEARCH_EMBEDDING_MODEL: 'test-embedding',
    SEARCH_EMBEDDING_DIMENSIONS: 2,
    SEARCH_EMBEDDING_TIMEOUT_MS: 1000,
    QDRANT_TIMEOUT_MS: 1000,
    QDRANT_COLLECTION_VERSION: 'v1',
  },
}));

vi.mock('@nibleaf/clickhouse', () => ({ insertUsageEvents: mocks.insertUsageEvents }));

vi.mock('@nibleaf/database', () => ({
  markUsageStorageWritten: mocks.markUsageStorageWritten,
  Prisma: { JsonNull: null, PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {} },
  prisma: (() => {
    const matches = (run: SearchRunState, where: SearchRunWhere): boolean => {
      if (where.id !== undefined && run.id !== where.id) return false;
      if (where.projectId !== undefined && run.projectId !== where.projectId) return false;
      if (where.deploymentId !== undefined && run.deploymentId !== where.deploymentId) return false;
      if (where.jobId !== undefined && run.jobId !== where.jobId) return false;
      if (where.claimToken !== undefined && run.claimToken !== where.claimToken) return false;
      if (where.updatedAt !== undefined && run.updatedAt.getTime() !== where.updatedAt.getTime()) return false;
      if (where.status !== undefined) {
        const filter = runStatusFilterSchema.safeParse(where.status);
        if (filter.success ? !filter.data.in.includes(run.status) : run.status !== where.status) return false;
      }
      return true;
    };
    const searchIndexRun = {
      findFirst: vi.fn(async ({ where }: { where: SearchRunWhere }) => mocks.runs.find((run) => matches(run, where)) ?? null),
      create: vi.fn(async ({ data }: { data: SearchRunCreate }) => {
        const now = new Date();
        const { projectId, deploymentId, ...values } = data;
        const run: SearchRunState = {
          id: data.id ?? `run-${mocks.runs.length + 1}`,
          projectId,
          deploymentId,
          jobId: data.jobId ?? null,
          status: 'PENDING',
          claimToken: null,
          claimExpiresAt: null,
          startedAt: null,
          updatedAt: now,
          indexedChunks: 0,
          embeddedChunks: 0,
          reusedChunks: 0,
          unchangedChunks: 0,
          metadataUpdatedChunks: 0,
          deletedChunks: 0,
          attempt: 0,
          ...values,
        };
        mocks.runs.push(run);
        return run;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: SearchRunWhere; data: SearchRunUpdate }) => {
        if (mocks.loseDisabledClaim && data.status === 'DISABLED') return { count: 0 };
        const run = mocks.runs.find((item) => matches(item, where));
        if (!run) return { count: 0 };
        const { attempt, ...values } = data;
        Object.assign(run, values);
        if (attempt) run.attempt += attempt.increment;
        run.updatedAt = new Date();
        return { count: 1 };
      }),
    };
    const db = {
      deployment: {
        findFirst: vi.fn(async (args: { select?: { snapshot?: boolean } }) => (args.select?.snapshot ? mocks.deployment : mocks.previousDeployment)),
      },
      project: { findUnique: vi.fn(async () => ({ accessMode: mocks.accessMode, organizationId: 'organization-a' })) },
      searchIndexRun,
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
    };
    return db;
  })(),
}));

vi.mock('@nibleaf/qdrant', () => ({
  getQdrantClient: () => ({
    vectorSize: 2,
    ensureHybridCollection: mocks.ensureHybridCollection,
    upsert: mocks.upsert,
    replacePayload: mocks.replacePayload,
    deletePoints: mocks.deletePoints,
    deleteByFilterAllVersions: mocks.deleteByFilterAllVersions,
    listIndexedPoints,
  }),
}));

vi.mock('@nibleaf/search', async () => {
  const hybrid = await import('../../../../packages/search/src/hybrid');
  return {
    ...hybrid,
    OpenRouterEmbeddingProvider: class {
      dimensions = 2;
      embed = mocks.embed;
    },
  };
});

import { handleSearchJobs } from './search';

let jobSequence = 0;
const job = (name: string, data: ReindexProjectJobData = { projectId: 'tenant-a', deploymentId: 'deployment-a' }, id = `${name}-${++jobSequence}`) =>
  ({ id, name, data, updateProgress: vi.fn(async () => undefined) }) as unknown as Job<ReindexProjectJobData>;

const firstUpsertedPoint = () => {
  const call = mocks.upsert.mock.calls[0];
  if (!call?.[0]?.[0]) throw new Error('Expected an indexed point.');
  return call[0][0];
};

describe('hybrid search differential indexing jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiKey = 'embedding-key';
    mocks.loseDisabledClaim = false;
    mocks.accessMode = 'READERS';
    mocks.currentPoints = [];
    mocks.previousPoints = [];
    mocks.previousDeployment = null;
    mocks.runs = [];
    jobSequence = 0;
  });

  it('embeds only visible pages and stamps deterministic tenant/deployment/language/private payloads', async () => {
    await expect(handleSearchJobs(job('index-deployment'))).resolves.toMatchObject({ indexed: 1, embedded: 1, reused: 0 });
    const point = firstUpsertedPoint();
    expect(point).toMatchObject({
      payload: {
        project_id: 'tenant-a',
        deployment_id: 'deployment-a',
        version_slug: 'main',
        language: 'ar',
        visibility: 'private',
        visible: true,
        page_id: 'page-ar',
        direction: 'rtl',
      },
    });
    expect(mocks.embed).toHaveBeenCalledOnce();
    expect(mocks.markUsageStorageWritten).toHaveBeenCalledWith('organization-a');
    expect(mocks.insertUsageEvents).toHaveBeenCalledWith([
      expect.objectContaining({ tenantId: 'organization-a', projectId: 'tenant-a', meterKey: 'embedded_chunk', quantity: '1' }),
      expect.objectContaining({ tenantId: 'organization-a', projectId: 'tenant-a', meterKey: 'indexed_content_byte' }),
    ]);
  });

  it('skips unchanged current-deployment chunks without embedding or writing them again', async () => {
    await handleSearchJobs(job('index-deployment'));
    const point = firstUpsertedPoint();
    mocks.currentPoints = [{ id: point.id, payload: point.payload }];
    mocks.embed.mockClear();
    mocks.upsert.mockClear();

    await expect(handleSearchJobs(job('index-deployment'))).resolves.toMatchObject({
      indexed: 0,
      embedded: 0,
      reused: 0,
      metadataUpdated: 0,
      unchanged: 1,
      deleted: 0,
    });
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('copies a matching predecessor vector for a new deployment instead of re-embedding unchanged content', async () => {
    await handleSearchJobs(job('index-deployment'));
    const point = firstUpsertedPoint();
    mocks.previousDeployment = { id: 'deployment-old' };
    mocks.previousPoints = [
      {
        id: 'old-point',
        payload: { ...point.payload, deployment_id: 'deployment-old' },
        vector: { dense: [0.7, 0.8], bm25: { indices: [1], values: [1] } },
      },
    ];
    mocks.embed.mockClear();
    mocks.upsert.mockClear();

    await expect(handleSearchJobs(job('index-deployment'))).resolves.toMatchObject({ indexed: 1, embedded: 0, reused: 1 });
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(firstUpsertedPoint().vector.dense).toEqual([0.7, 0.8]);
  });

  it('updates metadata without embeddings and deletes stale ids only inside the deployment tenant filter', async () => {
    await handleSearchJobs(job('index-deployment'));
    const point = firstUpsertedPoint();
    mocks.currentPoints = [
      { id: point.id, payload: { ...point.payload, visibility: 'public' } },
      { id: 'stale-point', payload: { ...point.payload, page_id: 'stale-page' } },
    ];
    mocks.embed.mockClear();
    mocks.upsert.mockClear();

    await expect(handleSearchJobs(job('reindex-project', { projectId: 'tenant-a' }))).resolves.toMatchObject({
      embedded: 0,
      metadataUpdated: 1,
      deleted: 1,
    });
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(mocks.replacePayload).toHaveBeenCalledWith(
      point.id,
      expect.objectContaining({ project_id: 'tenant-a', deployment_id: 'deployment-a', visibility: 'private' }),
      {
        must: [
          { key: 'project_id', match: { value: 'tenant-a' } },
          { key: 'deployment_id', match: { value: 'deployment-a' } },
        ],
      },
    );
    expect(mocks.deletePoints).toHaveBeenCalledWith(['stale-point'], {
      must: [
        { key: 'project_id', match: { value: 'tenant-a' } },
        { key: 'deployment_id', match: { value: 'deployment-a' } },
      ],
    });
    expect(JSON.stringify(mocks.deletePoints.mock.calls)).not.toContain('tenant-b');
  });

  it('can delete tenant data even when no embedding credential is configured', async () => {
    mocks.apiKey = undefined;
    await expect(handleSearchJobs(job('delete-project', { projectId: 'tenant-a' }))).resolves.toEqual({ deleted: true });
    expect(mocks.deleteByFilterAllVersions).toHaveBeenCalledWith({ must: [{ key: 'project_id', match: { value: 'tenant-a' } }] });
    expect(JSON.stringify(mocks.deleteByFilterAllVersions.mock.calls)).not.toContain('tenant-b');
    expect(mocks.embed).not.toHaveBeenCalled();
  });

  it('rejects a disabled result when the worker lost its durable run claim', async () => {
    mocks.apiKey = undefined;
    mocks.loseDisabledClaim = true;

    await expect(handleSearchJobs(job('index-deployment'))).rejects.toMatchObject({ errorCode: 'run_claim_lost' });
    expect(mocks.runs[0]).toMatchObject({ status: 'RUNNING' });
  });

  it('replays a terminal READY run as idempotent success after a BullMQ acknowledgement crash', async () => {
    const firstAttempt = job('index-deployment', undefined, 'search-deployment-a');
    await expect(handleSearchJobs(firstAttempt)).resolves.toMatchObject({ embedded: 1 });
    mocks.embed.mockClear();
    mocks.upsert.mockClear();

    await expect(handleSearchJobs(job('index-deployment', undefined, 'search-deployment-a'))).resolves.toMatchObject({
      status: 'READY',
      embedded: 1,
    });
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('recovers the same durable run after a crash left it PENDING', async () => {
    mocks.runs.push({
      id: 'run-pending',
      projectId: 'tenant-a',
      deploymentId: 'deployment-a',
      jobId: 'search-deployment-a',
      status: 'PENDING',
      claimToken: null,
      claimExpiresAt: null,
      startedAt: null,
      updatedAt: new Date(),
      indexedChunks: 0,
      embeddedChunks: 0,
      reusedChunks: 0,
      unchangedChunks: 0,
      metadataUpdatedChunks: 0,
      deletedChunks: 0,
      attempt: 0,
    });
    await expect(handleSearchJobs(job('index-deployment', undefined, 'search-deployment-a'))).resolves.toMatchObject({ embedded: 1 });
    expect(mocks.runs).toHaveLength(1);
    expect(mocks.runs[0]).toMatchObject({ id: 'run-pending', status: 'READY', attempt: 1 });
  });

  it('reclaims an expired RUNNING claim but does not create a second run', async () => {
    mocks.runs.push({
      id: 'run-stale',
      projectId: 'tenant-a',
      deploymentId: 'deployment-a',
      jobId: 'search-deployment-a',
      status: 'RUNNING',
      claimToken: 'dead-worker',
      claimExpiresAt: new Date(Date.now() - 1000),
      startedAt: new Date(Date.now() - 10_000),
      updatedAt: new Date(Date.now() - 1000),
      indexedChunks: 0,
      embeddedChunks: 0,
      reusedChunks: 0,
      unchangedChunks: 0,
      metadataUpdatedChunks: 0,
      deletedChunks: 0,
      attempt: 1,
    });
    await expect(handleSearchJobs(job('index-deployment', undefined, 'search-deployment-a'))).resolves.toMatchObject({ embedded: 1 });
    expect(mocks.runs).toHaveLength(1);
    expect(mocks.runs[0]).toMatchObject({ id: 'run-stale', status: 'READY', attempt: 2 });
  });
});
