import type { SearchScope } from '@nibleaf/search';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  queryHybrid: vi.fn(),
  embed: vi.fn(),
  resolveWorkspaceAi: vi.fn(),
}));
vi.mock('@nibleaf/qdrant', () => ({
  getQdrantClient: () => ({ vectorSize: 2, queryHybrid: doubles.queryHybrid }),
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

import { answerPublishedSearch, runPublishedSearch } from './runtime';

const scope: SearchScope = {
  projectId: 'project',
  deploymentId: 'deployment',
  versionSlug: 'main',
  language: 'ar',
  visibility: 'public',
  allowedPageIds: null,
};
const result = { id: 'booking', title: 'إضافة حجز', path: 'booking', description: '', snippet: 'حجز', score: 1 };

describe('hybrid index recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('keeps keyword search available while the published index is empty', async () => {
    doubles.queryHybrid.mockResolvedValue([]);
    const legacy = vi.fn().mockResolvedValue([result]);
    await expect(runPublishedSearch(scope, 'حجز جديد', 12, legacy)).resolves.toEqual({ hits: [result], runtime: 'legacy-fallback' });
    expect(legacy).toHaveBeenCalledOnce();
    expect(doubles.queryHybrid).toHaveBeenCalledWith(expect.objectContaining({ denseScoreThreshold: 0.35 }), undefined);
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
