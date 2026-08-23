import type { QdrantClient as QdrantSdkClient } from '@qdrant/js-client-rest';
import { describe, expect, it, vi } from 'vitest';
import { QdrantClient, type QdrantFilter } from './client';

const sdkClient = () => ({
  collectionExists: vi.fn(async (_collection: string) => ({ exists: true })),
  createCollection: vi.fn(async (_collection: string, _config: Record<string, unknown>) => true),
  createPayloadIndex: vi.fn(async (_collection: string, _config: Record<string, unknown>) => ({ status: 'completed' })),
  getAliases: vi.fn(async () => ({ aliases: [{ alias_name: 'search_active', collection_name: 'search_active_v1_1' }] })),
  updateCollectionAliases: vi.fn(async (_input: Record<string, unknown>) => true),
  versionInfo: vi.fn(async () => ({ title: 'qdrant', version: '1.19.0' })),
  upsert: vi.fn(async (_collection: string, _input: Record<string, unknown>) => ({ status: 'completed' })),
  delete: vi.fn(async (_collection: string, _input: Record<string, unknown>) => ({ status: 'completed' })),
  overwritePayload: vi.fn(async (_collection: string, _input: Record<string, unknown>) => ({ status: 'completed' })),
  getCollections: vi.fn(async () => ({ collections: [] as Array<{ name: string }> })),
  count: vi.fn(async (_collection: string, _input: Record<string, unknown>) => ({ count: 0 })),
  scroll: vi.fn(async (_collection: string, _input: Record<string, unknown>) => ({
    points: [] as Array<{ id: string | number; payload?: Record<string, unknown> | null }>,
    next_page_offset: null as string | number | null,
  })),
  query: vi.fn(async (_collection: string, _input: Record<string, unknown>) => ({ points: [] })),
});

const harness = (options: { alias?: string; schemaVersion?: string } = {}) => {
  const sdk = sdkClient();
  const client = new QdrantClient({
    url: 'https://qdrant.test',
    alias: options.alias,
    schemaVersion: options.schemaVersion,
    vectorSize: 1,
    client: sdk as unknown as QdrantSdkClient,
  });
  return { client, sdk };
};

const retrievalFilter = (): QdrantFilter => ({
  must: [
    { key: 'project_id', match: { value: 'tenant-a' } },
    { key: 'deployment_id', match: { value: 'dep-1' } },
    { key: 'version_slug', match: { value: 'main' } },
    { key: 'language', match: { value: 'ar' } },
    { key: 'visibility', match: { value: 'private' } },
    { key: 'visible', match: { value: true } },
    { key: 'page_id', match: { any: ['page-a'] } },
  ],
});

describe('QdrantClient official SDK boundary', () => {
  it('creates a missing hybrid collection, indexes its tenant fields, and establishes the read alias', async () => {
    const { client, sdk } = harness();
    sdk.collectionExists.mockResolvedValueOnce({ exists: false });
    sdk.getAliases.mockResolvedValueOnce({ aliases: [] });

    await expect(client.ensureHybridCollection()).resolves.toEqual({
      alias: 'nibleaf_search_active',
      collection: 'nibleaf_search_active_v1_1',
      created: true,
    });

    expect(sdk.createCollection).toHaveBeenCalledWith(
      'nibleaf_search_active_v1_1',
      expect.objectContaining({
        sparse_vectors: { bm25: { modifier: 'idf' } },
        vectors: { dense: { distance: 'Cosine', size: 1 } },
      }),
    );
    expect(sdk.createPayloadIndex).toHaveBeenCalledTimes(8);
    expect(sdk.updateCollectionAliases).toHaveBeenCalledWith({
      actions: [{ create_alias: { collection_name: 'nibleaf_search_active_v1_1', alias_name: 'nibleaf_search_active' } }],
    });
  });

  it('passes mandatory filters to both hybrid lanes and scopes IDF to the same authorized corpus', async () => {
    const { client, sdk } = harness();
    const filter = retrievalFilter();

    await client.queryHybrid({ dense: [0.1], sparse: { indices: [1], values: [1] }, filter, idfCorpus: filter, limit: 5 });

    expect(sdk.query).toHaveBeenCalledOnce();
    const call = sdk.query.mock.calls[0];
    if (!call) throw new Error('Expected the Qdrant SDK query to be called.');
    const [collection, input] = call;
    expect(collection).toBe('nibleaf_search_active');
    expect(input.filter).toEqual(filter);
    expect(input.prefetch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filter, params: { idf: { corpus: filter } }, using: 'bm25' }),
        expect.objectContaining({ filter, using: 'dense' }),
      ]),
    );
    expect(JSON.stringify(input)).not.toContain('tenant-b');
  });

  it('writes through the official SDK to the versioned physical collection and sweeps only owned rollback versions', async () => {
    const { client, sdk } = harness({ alias: 'search_active', schemaVersion: 'v2' });
    sdk.getCollections.mockResolvedValueOnce({
      collections: [{ name: 'search_active_v1_1' }, { name: 'search_active_v2_1' }, { name: 'unrelated_collection' }],
    });
    await client.upsert([
      {
        id: '11111111-1111-5111-a111-111111111111',
        vector: { dense: [0.1], bm25: { indices: [1], values: [1] } },
        payload: {
          project_id: 'tenant-a',
          deployment_id: 'deployment-a',
          version_slug: 'main',
          language: 'en',
          visibility: 'private',
          visible: true,
          page_id: 'page-a',
          content_hash: 'hash-a',
        },
      },
    ]);
    const filter: QdrantFilter = { must: [{ key: 'project_id', match: { value: 'tenant-a' } }] };
    await expect(client.deleteByFilterAllVersions(filter)).resolves.toBe(2);

    expect(sdk.upsert.mock.calls[0]?.[0]).toBe('search_active_v2_1');
    expect(sdk.delete.mock.calls.map(([collection]) => collection)).toEqual(['search_active_v1_1', 'search_active_v2_1']);
  });

  it('supports scoped differential reads, metadata replacement, and stale-id deletion without returning vectors', async () => {
    const { client, sdk } = harness();
    sdk.scroll
      .mockResolvedValueOnce({ points: [{ id: 'point-a', payload: { project_id: 'tenant-a', content_hash: 'hash-a' } }], next_page_offset: 2 })
      .mockResolvedValueOnce({ points: [{ id: 'point-b', payload: { project_id: 'tenant-a', content_hash: 'hash-b' } }], next_page_offset: null });
    const filter: QdrantFilter = {
      must: [
        { key: 'project_id', match: { value: 'tenant-a' } },
        { key: 'deployment_id', match: { value: 'deployment-a' } },
      ],
    };

    await expect(client.listIndexedPoints(filter)).resolves.toEqual([
      { id: 'point-a', payload: { project_id: 'tenant-a', content_hash: 'hash-a' } },
      { id: 'point-b', payload: { project_id: 'tenant-a', content_hash: 'hash-b' } },
    ]);
    expect(sdk.scroll.mock.calls[0]?.[1]).toMatchObject({ filter, with_payload: true, with_vector: false });
    expect(sdk.scroll.mock.calls[1]?.[1]).toMatchObject({ filter, offset: 2 });

    await client.replacePayload('point-a', { project_id: 'tenant-a', content_hash: 'hash-a' }, filter);
    await client.deletePoints(['point-b'], filter);
    expect(sdk.overwritePayload).toHaveBeenCalledWith(
      'nibleaf_search_active_v1_1',
      expect.objectContaining({ filter: { must: [...filter.must, { has_id: ['point-a'] }] } }),
    );
    expect(sdk.delete).toHaveBeenCalledWith(
      'nibleaf_search_active_v1_1',
      expect.objectContaining({ filter: { must: [...filter.must, { has_id: ['point-b'] }] } }),
    );
  });

  it('fails before SDK I/O when counts, deletes, diffs, or retrieval omit mandatory tenant scope', async () => {
    const { client, sdk } = harness();
    await expect(client.count({ must: [] })).rejects.toThrow('project_id');
    await expect(client.deleteByFilter({ must: [{ key: 'deployment_id', match: { value: 'dep' } }] })).rejects.toThrow('project_id');
    await expect(client.listIndexedPoints({ must: [] })).rejects.toThrow('project_id');
    await expect(
      client.queryHybrid({
        dense: [0.1],
        sparse: { indices: [1], values: [1] },
        filter: { must: [{ key: 'project_id', match: { value: 'tenant-a' } }] },
        idfCorpus: { must: [{ key: 'project_id', match: { value: 'tenant-a' } }] },
        limit: 1,
      }),
    ).rejects.toThrow('deployment_id');
    expect(sdk.count).not.toHaveBeenCalled();
    expect(sdk.delete).not.toHaveBeenCalled();
    expect(sdk.scroll).not.toHaveBeenCalled();
    expect(sdk.query).not.toHaveBeenCalled();
  });

  it('rejects a broader IDF corpus so unauthorized pages cannot affect scores', async () => {
    const { client, sdk } = harness();
    const filter = retrievalFilter();
    await expect(
      client.queryHybrid({
        dense: [0.1],
        sparse: { indices: [1], values: [1] },
        filter,
        idfCorpus: { must: filter.must.filter((condition) => !('key' in condition) || condition.key !== 'page_id') },
        limit: 1,
      }),
    ).rejects.toThrow('IDF corpus');
    expect(sdk.query).not.toHaveBeenCalled();
  });
});
