import type { ReindexProjectJobData } from '@nibleaf/bullmq/jobs/search';
import type { QdrantFilter, QdrantIndexedPoint, QdrantPoint } from '@nibleaf/qdrant';
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiKey: 'embedding-key' as string | undefined,
  accessMode: 'READERS' as 'PUBLIC' | 'WORKSPACE' | 'READERS',
  currentPoints: [] as QdrantIndexedPoint[],
  previousPoints: [] as QdrantIndexedPoint[],
  previousDeployment: null as { id: string } | null,
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
}));

const deploymentIdFrom = (filter: QdrantFilter) => {
  for (const condition of filter.must) {
    if ('key' in condition && condition.key === 'deployment_id') return condition.match.value;
  }
  return undefined;
};

const listIndexedPoints = vi.fn(async (filter: QdrantFilter, includeVectors = false) => {
  const deploymentId = deploymentIdFrom(filter);
  if (deploymentId === 'deployment-old') return includeVectors ? mocks.previousPoints : [];
  return mocks.currentPoints;
});

vi.mock('../env', () => ({
  env: {
    get SEARCH_EMBEDDING_API_KEY() {
      return mocks.apiKey;
    },
    OPENAI_API_KEY: undefined,
    SEARCH_EMBEDDING_BASE_URL: 'https://embeddings.test/v1',
    SEARCH_EMBEDDING_MODEL: 'test-embedding',
    SEARCH_EMBEDDING_DIMENSIONS: 2,
    SEARCH_EMBEDDING_TIMEOUT_MS: 1_000,
  },
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    deployment: {
      findFirst: vi.fn(async (args: { select?: { snapshot?: boolean } }) => (args.select?.snapshot ? mocks.deployment : mocks.previousDeployment)),
    },
    project: { findUnique: vi.fn(async () => ({ accessMode: mocks.accessMode })) },
  },
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
    OpenAIEmbeddingProvider: class {
      dimensions = 2;
      embed = mocks.embed;
    },
  };
});

import { handleSearchJobs } from './search';

const job = (name: string, data: ReindexProjectJobData = { projectId: 'tenant-a', deploymentId: 'deployment-a' }) =>
  ({ name, data, updateProgress: vi.fn(async () => undefined) }) as unknown as Job<ReindexProjectJobData>;

const firstUpsertedPoint = () => {
  const call = mocks.upsert.mock.calls[0];
  if (!call?.[0]?.[0]) throw new Error('Expected an indexed point.');
  return call[0][0];
};

describe('hybrid search differential indexing jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiKey = 'embedding-key';
    mocks.accessMode = 'READERS';
    mocks.currentPoints = [];
    mocks.previousPoints = [];
    mocks.previousDeployment = null;
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
});
