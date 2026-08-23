import type { ReindexProjectJobData } from '@nibleaf/bullmq/jobs/search';
import type { QdrantPoint } from '@nibleaf/qdrant';
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiKey: 'embedding-key' as string | undefined,
  accessMode: 'READERS' as 'PUBLIC' | 'WORKSPACE' | 'READERS',
  deployment: {
    id: 'deployment-a',
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
  upsert: vi.fn(async () => undefined),
  deleteByFilter: vi.fn(async () => undefined),
  deleteByFilterAllVersions: vi.fn(async () => 1),
  embed: vi.fn(async (inputs: string[]) => ({ vectors: inputs.map(() => [0.1, 0.2]), model: 'test' })),
}));

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
    deployment: { findFirst: vi.fn(async () => mocks.deployment) },
    project: { findUnique: vi.fn(async () => ({ accessMode: mocks.accessMode })) },
  },
}));

vi.mock('@nibleaf/qdrant', () => ({
  getQdrantClient: () => ({
    vectorSize: 2,
    ensureHybridCollection: mocks.ensureHybridCollection,
    upsert: mocks.upsert,
    deleteByFilter: mocks.deleteByFilter,
    deleteByFilterAllVersions: mocks.deleteByFilterAllVersions,
  }),
}));

vi.mock('@nibleaf/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nibleaf/search')>();
  return {
    ...actual,
    OpenAICompatibleEmbeddingProvider: class {
      dimensions = 2;
      embed = mocks.embed;
    },
  };
});

import { handleSearchJobs } from './search';

const job = (name: string, data: ReindexProjectJobData = { projectId: 'tenant-a', deploymentId: 'deployment-a' }) =>
  ({ name, data, updateProgress: vi.fn(async () => undefined) }) as unknown as Job<ReindexProjectJobData>;

describe('hybrid search indexing jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiKey = 'embedding-key';
    mocks.accessMode = 'READERS';
  });

  it('indexes only visible pages with deterministic tenant/deployment/language/private payloads', async () => {
    const first = job('index-deployment');
    await expect(handleSearchJobs(first)).resolves.toMatchObject({ indexed: 1 });
    const firstPoints = (mocks.upsert.mock.calls as unknown as Array<[QdrantPoint[]]>)[0]?.[0] ?? [];
    expect(firstPoints).toHaveLength(1);
    expect(firstPoints[0]).toMatchObject({
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

    mocks.upsert.mockClear();
    await handleSearchJobs(job('index-deployment'));
    expect((mocks.upsert.mock.calls as unknown as Array<[QdrantPoint[]]>)[0]?.[0]?.[0]?.id).toBe(firstPoints[0]?.id);
  });

  it('reindexes idempotently without clearing the active alias before replacement points exist', async () => {
    await handleSearchJobs(job('reindex-project', { projectId: 'tenant-a' }));
    expect(mocks.deleteByFilter).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalled();
  });

  it('can delete tenant data even when no embedding credential is configured', async () => {
    mocks.apiKey = undefined;
    await expect(handleSearchJobs(job('delete-project', { projectId: 'tenant-a' }))).resolves.toEqual({ deleted: true });
    expect(mocks.deleteByFilterAllVersions).toHaveBeenCalledWith({ must: [{ key: 'project_id', match: { value: 'tenant-a' } }] });
    expect(JSON.stringify(mocks.deleteByFilterAllVersions.mock.calls)).not.toContain('tenant-b');
    expect(mocks.embed).not.toHaveBeenCalled();
  });
});
