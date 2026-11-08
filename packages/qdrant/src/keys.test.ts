import { afterEach, describe, expect, it, vi } from 'vitest';
import { getQdrantClient } from './client';

afterEach(() => vi.unstubAllEnvs());

describe('Qdrant collection settings', () => {
  it('sizes the collection from the pinned embedding width when the vector size is unset', () => {
    vi.stubEnv('QDRANT_URL', 'https://qdrant.test');
    vi.stubEnv('QDRANT_VECTOR_SIZE', '');
    vi.stubEnv('QDRANT_COLLECTION_VERSION', 'v1');
    vi.stubEnv('SEARCH_EMBEDDING_DIMENSIONS', '1536');
    expect(getQdrantClient()).toMatchObject({ vectorSize: 1536, collection: 'nibleaf_search_active_v1_1536' });
  });
});
