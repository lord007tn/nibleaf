import type { SearchScope } from '@nibleaf/search';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  queryHybrid: vi.fn(),
  embed: vi.fn(),
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
  },
}));
vi.mock('@nibleaf/search', async (original) => ({
  ...(await original<typeof import('@nibleaf/search')>()),
  OpenRouterEmbeddingProvider: class {
    dimensions = 2;
    embed = doubles.embed;
  },
}));

import { runPublishedSearch } from './runtime';

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
  });

  it('keeps keyword search available while the published index is empty', async () => {
    doubles.queryHybrid.mockResolvedValue([]);
    const legacy = vi.fn().mockResolvedValue([result]);
    await expect(runPublishedSearch(scope, 'حجز جديد', 12, legacy)).resolves.toEqual({ hits: [result], runtime: 'legacy-fallback' });
    expect(legacy).toHaveBeenCalledOnce();
  });

  it('falls back when the provider is unavailable', async () => {
    doubles.queryHybrid.mockRejectedValue(new Error('temporary index outage'));
    await expect(runPublishedSearch(scope, 'غرفة', 12, async () => [result])).resolves.toEqual({ hits: [result], runtime: 'legacy-fallback' });
  });

  it('falls back after rejecting an incorrectly scoped point', async () => {
    doubles.queryHybrid.mockResolvedValue([{ id: 'foreign', score: 1, payload: { project_id: 'another-tenant' } }]);
    await expect(runPublishedSearch(scope, 'عميل', 12, async () => [result])).resolves.toEqual({ hits: [result], runtime: 'legacy-fallback' });
  });
});
