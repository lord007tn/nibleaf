import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  access: {
    role: 'admin',
    organizationId: 'org-a',
    project: { id: 'project-a', config: {} as unknown },
  },
  deployment: { id: 'deployment-a', version: 3 } as { id: string; version: number } | null,
  latestRun: null as Record<string, unknown> | null,
  activeRun: null as { id: string; deploymentId: string | null; jobId: string | null; status: 'PENDING' | 'RUNNING'; createdAt: Date } | null,
  assertProjectAccess: vi.fn(),
  findDeployment: vi.fn(),
  findRun: vi.fn(),
  findProject: vi.fn(),
  createRun: vi.fn(),
  updateManyRun: vi.fn(),
  createJob: vi.fn(),
  listMetadata: vi.fn(),
  count: vi.fn(),
  facets: vi.fn(),
}));

vi.mock('@/env', () => ({
  env: {
    BETTER_AUTH_SECRET: 'test-secret-with-at-least-thirty-two-characters',
    SEARCH_RUNTIME: 'shadow',
    QDRANT_COLLECTION_VERSION: 'v1',
    SEARCH_EMBEDDING_MODEL: 'test-embedding',
    SEARCH_EMBEDDING_DIMENSIONS: 1536,
    OPENROUTER_API_KEY: 'provider-key',
  },
}));

vi.mock('@nibleaf/database', () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(code: string) {
        super(code);
        this.code = code;
      }
    },
  },
  prisma: {
    deployment: { findFirst: mocks.findDeployment },
    searchIndexRun: { findFirst: mocks.findRun, create: mocks.createRun, updateMany: mocks.updateManyRun },
    project: { findFirst: mocks.findProject },
    $transaction: vi.fn(),
  },
}));

vi.mock('@nibleaf/qdrant', () => ({
  getQdrantClient: () => ({
    listIndexedMetadataPage: mocks.listMetadata,
    count: mocks.count,
    facetCounts: mocks.facets,
  }),
}));

vi.mock('./projects', () => ({ assertProjectAccess: mocks.assertProjectAccess }));
vi.mock('./sites', () => ({ invalidatePublishedSiteConfig: vi.fn() }));
vi.mock('@nibleaf/bullmq', () => ({ QueueNames: { SEARCH: 'search' }, createJob: mocks.createJob }));

import {
  createProjectSearchReindex,
  getProjectSearchConfiguration,
  getProjectSearchIndexDiagnostics,
  updateProjectSearchConfiguration,
} from './search';

const context = (
  options: { user?: { id: string }; apiKey?: { projectId: string; scopes: string[] }; project?: { id: string; organizationId: string } } = {},
) => ({ get: (key: string) => options[key as keyof typeof options] }) as Context<HonoEnv>;

describe('tenant-safe search actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.role = 'admin';
    mocks.access.organizationId = 'org-a';
    mocks.access.project = { id: 'project-a', config: {} };
    mocks.deployment = { id: 'deployment-a', version: 3 };
    mocks.latestRun = null;
    mocks.activeRun = null;
    mocks.assertProjectAccess.mockImplementation(async (_userId: string, projectId: string) => {
      if (projectId !== 'project-a') throw new Error('project not found');
      return mocks.access;
    });
    mocks.findDeployment.mockImplementation(async () => mocks.deployment);
    mocks.findRun.mockImplementation(async ({ where }: { where: { status?: unknown } }) => (where.status ? mocks.activeRun : mocks.latestRun));
    mocks.findProject.mockResolvedValue({ id: 'project-a', organizationId: 'org-a', config: {} });
    mocks.createRun.mockImplementation(async ({ data }: { data: { id: string; deploymentId: string; jobId: string } }) => ({
      id: data.id,
      deploymentId: data.deploymentId,
      jobId: data.jobId,
      status: 'PENDING',
      createdAt: new Date('2026-08-23T12:00:00Z'),
    }));
    mocks.updateManyRun.mockResolvedValue({ count: 1 });
    mocks.createJob.mockResolvedValue({});
    mocks.listMetadata.mockResolvedValue({
      points: [{ id: 'point-a', payload: { page_id: 'page-a', ordinal: 0, language: 'ar', version_slug: 'main' } }],
      nextOffset: 9,
    });
    mocks.count.mockResolvedValue(1);
    mocks.facets.mockImplementation(async (_filter: unknown, key: string) =>
      key === 'language' ? [{ value: 'ar', count: 1 }] : [{ value: 'main', count: 1 }],
    );
  });

  it('defaults a malformed legacy search section instead of throwing', async () => {
    mocks.access.project.config = { search: { maxResults: 'unbounded', placeholder: { private: true } }, theme: { custom: true } };
    await expect(getProjectSearchConfiguration(context({ user: { id: 'user-a' } }), 'project-a')).resolves.toMatchObject({
      configuration: { maxResults: 12, filtersEnabled: true, versionFilterEnabled: true, placeholder: null },
      constraints: { maxResults: { default: 12, min: 1, max: 50 } },
    });
  });

  it('returns not_published with no historical run or Qdrant access when there is no READY deployment', async () => {
    mocks.deployment = null;
    const result = await getProjectSearchIndexDiagnostics(context({ user: { id: 'user-a' } }), 'project-a', { limit: 10 });
    expect(result).toMatchObject({ availability: { reason: 'not_published' }, latestRun: null });
    expect(mocks.findRun).not.toHaveBeenCalled();
    expect(mocks.listMetadata).not.toHaveBeenCalled();
  });

  it('scopes exact counts, facets, and bounded samples to the authorized current revision without private fields', async () => {
    const result = await getProjectSearchIndexDiagnostics(context({ user: { id: 'user-a' } }), 'project-a', { limit: 10 });
    const expectedFilter = {
      must: [
        { key: 'project_id', match: { value: 'project-a' } },
        { key: 'deployment_id', match: { value: 'deployment-a' } },
      ],
    };
    expect(mocks.findRun).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: 'project-a', deploymentId: 'deployment-a' } }));
    expect(mocks.count).toHaveBeenCalledWith(expectedFilter);
    expect(mocks.listMetadata).toHaveBeenCalledWith(expectedFilter, { limit: 10, offset: undefined });
    expect(result.samples.items[0]).toMatchObject({ pageId: 'page-a', language: 'ar', versionSlug: 'main' });
    expect(result.samples.nextCursor?.startsWith('v1.')).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/"(?:content|vector|title|path|collection|alias|providerPayload)":/i);
  });

  it('rejects cross-tenant access before any index provider call', async () => {
    await expect(getProjectSearchIndexDiagnostics(context({ user: { id: 'user-a' } }), 'project-b', { limit: 10 })).rejects.toThrow(
      'project not found',
    );
    expect(mocks.findDeployment).not.toHaveBeenCalled();
    expect(mocks.listMetadata).not.toHaveBeenCalled();
  });

  it('rejects non-admin configuration mutation before opening a transaction', async () => {
    mocks.access.role = 'member';
    await expect(updateProjectSearchConfiguration(context({ user: { id: 'user-a' } }), 'project-a', { maxResults: 20 })).rejects.toMatchObject({
      code: 'auth:insufficient_role',
    });
  });

  it('binds API keys to the exact project and required read/write/reindex scopes', async () => {
    const project = { id: 'project-a', organizationId: 'org-a' };
    await expect(
      getProjectSearchConfiguration(
        context({ apiKey: { projectId: 'project-a', scopes: ['search:read'] }, project, user: { id: 'key-owner' } }),
        'project-a',
      ),
    ).resolves.toMatchObject({ configuration: { maxResults: 12 } });
    await expect(
      getProjectSearchConfiguration(
        context({ apiKey: { projectId: 'project-b', scopes: ['search:read'] }, project, user: { id: 'key-owner' } }),
        'project-a',
      ),
    ).rejects.toMatchObject({ code: 'database:not_found' });
    await expect(
      updateProjectSearchConfiguration(
        context({ apiKey: { projectId: 'project-a', scopes: ['search:read'] }, project, user: { id: 'key-owner' } }),
        'project-a',
        { maxResults: 20 },
      ),
    ).rejects.toMatchObject({ code: 'auth:insufficient_role' });
    await expect(
      createProjectSearchReindex(
        context({ apiKey: { projectId: 'project-a', scopes: ['search:read'] }, project, user: { id: 'key-owner' } }),
        'project-a',
      ),
    ).rejects.toMatchObject({ code: 'auth:insufficient_role' });
    expect(mocks.listMetadata).not.toHaveBeenCalled();
  });

  it('rejects tampered and cross-project/revision cursor replay before Qdrant', async () => {
    const first = await getProjectSearchIndexDiagnostics(context({ user: { id: 'user-a' } }), 'project-a', { limit: 10 });
    const cursor = first.samples.nextCursor;
    if (!cursor) throw new Error('Expected a diagnostics cursor.');
    vi.clearAllMocks();
    mocks.assertProjectAccess.mockResolvedValue(mocks.access);
    mocks.findDeployment.mockResolvedValue({ id: 'deployment-a', version: 3 });
    await expect(
      getProjectSearchIndexDiagnostics(context({ user: { id: 'user-a' } }), 'project-a', { limit: 10, cursor: `${cursor}x` }),
    ).rejects.toMatchObject({ code: 'validation:failed' });
    await expect(getProjectSearchIndexDiagnostics(context({ user: { id: 'user-a' } }), 'project-b', { limit: 10, cursor })).rejects.toMatchObject({
      code: 'validation:failed',
    });
    mocks.findDeployment.mockResolvedValue({ id: 'deployment-b', version: 4 });
    await expect(getProjectSearchIndexDiagnostics(context({ user: { id: 'user-a' } }), 'project-a', { limit: 10, cursor })).rejects.toMatchObject({
      code: 'validation:failed',
    });
    expect(mocks.listMetadata).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it('projects provider failure truthfully with unknown corpus values and the current revision run only', async () => {
    mocks.latestRun = {
      id: 'run-a',
      deploymentId: 'deployment-a',
      status: 'FAILED',
      expectedChunks: 4,
      indexedChunks: 3,
      indexedPages: 2,
      embeddedChunks: 1,
      reusedChunks: 1,
      unchangedChunks: 1,
      metadataUpdatedChunks: 0,
      deletedChunks: 0,
      staleChunks: 1,
      failedChunks: 1,
      errorCode: 'embedding_failed',
      issueSample: [{ pageId: 'page-a', ordinal: 2, language: 'ar', versionSlug: 'main', status: 'failed', errorCode: 'embedding_failed' }],
      startedAt: new Date('2026-08-23T10:00:00Z'),
      completedAt: new Date('2026-08-23T10:01:00Z'),
    };
    mocks.count.mockRejectedValueOnce(new Error('provider down'));
    const result = await getProjectSearchIndexDiagnostics(context({ user: { id: 'user-a' } }), 'project-a', { limit: 10 });
    expect(result).toMatchObject({
      availability: { reason: 'provider_unavailable' },
      corpus: { chunks: null, pages: null },
      latestRun: { id: 'run-a', errorCode: 'embedding_failed' },
    });
    expect(JSON.stringify(result)).not.toMatch(/"(?:content|hash|vector|title|path|providerPayload)":/i);
  });

  it('returns opaque no-READY and distinct active-run conflict errors', async () => {
    mocks.deployment = null;
    await expect(createProjectSearchReindex(context({ user: { id: 'user-a' } }), 'project-a')).rejects.toMatchObject({
      code: 'database:not_found',
      entityType: 'deployment',
    });

    mocks.deployment = { id: 'deployment-a', version: 3 };
    const KnownError = (await import('@nibleaf/database')).Prisma.PrismaClientKnownRequestError;
    mocks.createRun.mockRejectedValueOnce(new KnownError('P2002', { code: 'P2002', clientVersion: 'test' }));
    await expect(createProjectSearchReindex(context({ user: { id: 'user-a' } }), 'project-a')).rejects.toMatchObject({ code: 'database:conflict' });
    mocks.activeRun = {
      id: 'run-live',
      deploymentId: 'deployment-a',
      jobId: 'search-reindex-run-live',
      status: 'RUNNING',
      createdAt: new Date('2026-08-23T12:00:00Z'),
    };
    await expect(createProjectSearchReindex(context({ user: { id: 'user-a' } }), 'project-a')).rejects.toMatchObject({ code: 'database:conflict' });
  });

  it('recovers a committed PENDING run and safely ensures the same durable queue job after an unknown enqueue outcome', async () => {
    mocks.activeRun = {
      id: 'run-pending',
      deploymentId: 'deployment-a',
      jobId: 'search-reindex-run-pending',
      status: 'PENDING',
      createdAt: new Date('2026-08-23T12:00:00Z'),
    };
    mocks.createJob.mockRejectedValueOnce(new Error('redis down'));
    await expect(createProjectSearchReindex(context({ user: { id: 'user-a' } }), 'project-a')).rejects.toMatchObject({ code: 'search:unavailable' });
    expect(mocks.updateManyRun).toHaveBeenCalledWith({
      where: { id: 'run-pending', status: 'PENDING', jobId: 'search-reindex-run-pending' },
      data: { errorCode: 'queue_unavailable' },
    });
    await expect(createProjectSearchReindex(context({ user: { id: 'user-a' } }), 'project-a')).resolves.toMatchObject({ id: 'run-pending' });
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.createJob).toHaveBeenLastCalledWith(
      'search',
      { name: 'reindex-project', data: { projectId: 'project-a', deploymentId: 'deployment-a', runId: 'run-pending' } },
      { jobId: 'search-reindex-run-pending' },
    );
    expect(mocks.updateManyRun).toHaveBeenLastCalledWith({
      where: { id: 'run-pending', status: 'PENDING', jobId: 'search-reindex-run-pending' },
      data: { errorCode: null },
    });
  });

  it('recovers the winning PENDING row when concurrent requests race on the active-run constraint', async () => {
    const KnownError = (await import('@nibleaf/database')).Prisma.PrismaClientKnownRequestError;
    mocks.createRun.mockImplementationOnce(async () => {
      mocks.activeRun = {
        id: 'run-winner',
        deploymentId: 'deployment-a',
        jobId: 'search-reindex-run-winner',
        status: 'PENDING',
        createdAt: new Date('2026-08-23T12:00:00Z'),
      };
      throw new KnownError('P2002', { code: 'P2002', clientVersion: 'test' });
    });
    await expect(createProjectSearchReindex(context({ user: { id: 'user-a' } }), 'project-a')).resolves.toMatchObject({ id: 'run-winner' });
    expect(mocks.createJob).toHaveBeenCalledWith(
      'search',
      { name: 'reindex-project', data: { projectId: 'project-a', deploymentId: 'deployment-a', runId: 'run-winner' } },
      { jobId: 'search-reindex-run-winner' },
    );
  });
});
