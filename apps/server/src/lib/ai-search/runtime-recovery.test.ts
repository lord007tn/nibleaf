import type { SearchScope } from '@nibleaf/search';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  queryHybrid: vi.fn(),
  embed: vi.fn(),
  resolveWorkspaceAi: vi.fn(),
  servedCollection: vi.fn(),
  runs: [] as Array<Record<string, unknown> & { createdAt: Date }>,
}));
vi.mock('@nibleaf/qdrant', () => ({
  getQdrantClient: () => ({
    alias: 'search_active',
    collection: 'search_active_v1_2',
    vectorSize: 2,
    queryHybrid: doubles.queryHybrid,
    servedCollection: doubles.servedCollection,
  }),
}));
// The newest run matching every field of the query, as Prisma orders them.
vi.mock('@nibleaf/database', () => ({
  prisma: {
    searchIndexRun: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        doubles.runs
          .filter((run) => Object.entries(where).every(([key, value]) => run[key] === value))
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null,
    },
  },
}));
vi.mock('@/env', () => ({
  env: {
    SEARCH_RUNTIME: 'hybrid',
    OPENROUTER_API_KEY: 'test-only',
    SEARCH_EMBEDDING_MODEL: 'test',
    SEARCH_EMBEDDING_DIMENSIONS: 2,
    QDRANT_COLLECTION_VERSION: 'v1',
    SEARCH_CACHE_TTL_MS: 100,
    SEARCH_CANDIDATE_LIMIT: 48,
    SEARCH_DENSE_MIN_SCORE: 0.35,
  },
}));
vi.mock('@nibleaf/search/workspace', () => ({
  resolveWorkspaceAi: doubles.resolveWorkspaceAi,
  workspaceEmbeddingProvider: () => ({ dimensions: 2, model: 'test', embed: doubles.embed }),
  workspaceAnswerProvider: () => ({ model: 'test', complete: vi.fn() }),
}));

import { answerPublishedSearch, answerSearchAvailable, runPublishedSearch } from './runtime';

const scope: SearchScope = {
  projectId: 'project',
  deploymentId: 'deployment',
  versionSlug: 'main',
  language: 'ar',
  visibility: 'public',
  allowedPageIds: null,
};
const result = { id: 'booking', title: 'إضافة حجز', path: 'booking', description: '', snippet: 'حجز', score: 1 };

// Each test reads the alias afresh: the server trusts one reading for 30 seconds.
let clock = Date.parse('2026-11-08T00:00:00Z');
// Built with the settings this test's instance runs (v1, the `test` model, 2 dimensions).
const readyRun = {
  projectId: 'project',
  deploymentId: 'deployment',
  status: 'READY',
  indexedChunks: 4,
  schemaVersion: 'v1',
  embeddingModel: 'test',
  vectorSize: 2,
  createdAt: new Date('2026-11-01T00:00:00Z'),
};

describe('hybrid index recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    clock += 60_000;
    vi.setSystemTime(clock);
    doubles.servedCollection.mockResolvedValue('search_active_v1_2');
    doubles.runs = [readyRun];
    doubles.embed.mockResolvedValue({ vectors: [[1, 0]] });
    doubles.resolveWorkspaceAi.mockResolvedValue({
      providerId: 'openrouter',
      apiKey: 'test-only',
      embeddingModel: 'test',
      answerModel: 'test',
      revision: 'test',
      answersEnabled: true,
    });
  });

  it('reports AI answers unavailable instead of failing the site when readiness cannot be read', async () => {
    doubles.resolveWorkspaceAi.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(answerSearchAvailable('project', 'deployment')).resolves.toBe(false);
  });

  it('keeps keyword search, without embedding the query, and pauses AI answers while the alias serves an earlier collection', async () => {
    doubles.servedCollection.mockResolvedValue('search_active_v1_1');
    const legacy = vi.fn().mockResolvedValue([result]);
    await expect(runPublishedSearch(scope, 'حجز', 12, legacy)).resolves.toEqual({ hits: [result], runtime: 'legacy-fallback' });
    expect(doubles.embed).not.toHaveBeenCalled();
    await expect(answerSearchAvailable('project', 'deployment')).resolves.toBe(false);
    await expect(answerPublishedSearch(scope, 'حجز')).rejects.toThrow('AI answers are not configured.');
  });

  it('offers AI answers only from an index built with the current embedding settings', async () => {
    await expect(answerSearchAvailable('project', 'deployment')).resolves.toBe(true);
    doubles.runs = [{ ...readyRun, embeddingModel: 'earlier-model', vectorSize: 1 }];
    await expect(answerSearchAvailable('project', 'deployment')).resolves.toBe(false);
  });

  it('reads the alias again a few seconds after a failed reading, not half a minute later', async () => {
    doubles.servedCollection.mockRejectedValueOnce(new Error('qdrant unavailable'));
    await expect(answerSearchAvailable('project', 'deployment')).resolves.toBe(false);
    clock += 6000;
    vi.setSystemTime(clock);
    await expect(answerSearchAvailable('project', 'deployment')).resolves.toBe(true);
    expect(doubles.servedCollection).toHaveBeenCalledTimes(2);
  });

  it('keeps AI answers on the retained index after rolling back from a newer embedding rebuild', async () => {
    // v1 READY, then a v2 rebuild READY; the instance is back on v1 and the alias serves v1 again.
    doubles.runs = [
      readyRun,
      { ...readyRun, schemaVersion: 'v2', embeddingModel: 'larger-model', vectorSize: 3, createdAt: new Date('2026-11-05T00:00:00Z') },
    ];
    await expect(answerSearchAvailable('project', 'deployment')).resolves.toBe(true);
  });

  it('keeps keyword search available while the published index is empty', async () => {
    doubles.queryHybrid.mockResolvedValue([]);
    const legacy = vi.fn().mockResolvedValue([result]);
    await expect(runPublishedSearch(scope, 'حجز جديد', 12, legacy)).resolves.toEqual({ hits: [result], runtime: 'legacy-fallback' });
    expect(legacy).toHaveBeenCalledOnce();
    expect(doubles.queryHybrid).toHaveBeenCalledWith(
      expect.objectContaining({ denseScoreThreshold: 0.35, limit: 48, candidateLimit: 48 }),
      undefined,
    );
  });

  it('falls back when the provider is unavailable', async () => {
    doubles.queryHybrid.mockRejectedValue(new Error('temporary index outage'));
    await expect(runPublishedSearch(scope, 'غرفة', 12, async () => [result])).resolves.toEqual({ hits: [result], runtime: 'legacy-fallback' });
  });

  it('falls back after rejecting an incorrectly scoped point', async () => {
    doubles.queryHybrid.mockResolvedValue([{ id: 'foreign', score: 1, payload: { project_id: 'another-tenant' } }]);
    await expect(runPublishedSearch(scope, 'عميل', 12, async () => [result])).resolves.toEqual({ hits: [result], runtime: 'legacy-fallback' });
  });

  it('checks live provider state before returning a cached answer', async () => {
    doubles.queryHybrid.mockResolvedValue([]);
    await answerPublishedSearch(scope, 'cached-answer-disable');
    doubles.resolveWorkspaceAi.mockResolvedValue(null);
    await expect(answerPublishedSearch(scope, 'cached-answer-disable')).rejects.toThrow('AI answers are not configured.');
  });

  it('does not reuse retrieval or answer caches after a credential revision changes', async () => {
    doubles.queryHybrid.mockResolvedValue([]);
    await answerPublishedSearch(scope, 'cached-answer-revision');
    doubles.resolveWorkspaceAi.mockResolvedValue({
      providerId: 'openrouter',
      apiKey: 'replacement-test-only',
      embeddingModel: 'test',
      answerModel: 'test',
      revision: 'test:2',
      answersEnabled: true,
    });
    await expect(answerPublishedSearch(scope, 'cached-answer-revision')).resolves.toMatchObject({ cacheHit: false });
    expect(doubles.embed).toHaveBeenCalledTimes(2);
  });
});
