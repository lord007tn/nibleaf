import { describe, expect, it, vi } from 'vitest';
import { QdrantClient, type QdrantFilter } from './client';

const ok = (result: unknown) => new Response(JSON.stringify({ result }), { status: 200, headers: { 'content-type': 'application/json' } });

describe('QdrantClient tenant safety', () => {
  it('passes the mandatory retrieval filter to both lanes and scopes IDF to the tenant corpus', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(ok({ points: [] }));
    const client = new QdrantClient({ url: 'http://qdrant.test:6333', fetch: request, timeoutMs: 1000, vectorSize: 1 });
    const filter: QdrantFilter = {
      must: [
        { key: 'project_id', match: { value: 'tenant-a' } },
        { key: 'deployment_id', match: { value: 'dep-1' } },
        { key: 'version_slug', match: { value: 'main' } },
        { key: 'language', match: { value: 'ar' } },
        { key: 'visibility', match: { value: 'private' } },
        { key: 'visible', match: { value: true } },
        { key: 'page_id', match: { any: ['page-a'] } },
      ],
    };
    const idfCorpus = filter;

    await client.queryHybrid({ dense: [0.1], sparse: { indices: [1], values: [1] }, filter, idfCorpus, limit: 5 });

    const init = request.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));
    expect(body.filter).toEqual(filter);
    expect(body.prefetch[0].filter).toEqual(filter);
    expect(body.prefetch[1].filter).toEqual(filter);
    expect(body.prefetch[0].params.idf.corpus).toEqual(idfCorpus);
    expect(JSON.stringify(body)).not.toContain('tenant-b');
  });

  it('never sends API credentials in the URL or body', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(ok({ count: 0 }));
    const client = new QdrantClient({ url: 'https://qdrant.test', apiKey: 'top-secret', fetch: request });
    await client.count({ must: [{ key: 'project_id', match: { value: 'tenant-a' } }] });
    const [url, init] = request.mock.calls[0] ?? [];
    expect(String(url)).not.toContain('top-secret');
    expect(String(init?.body)).not.toContain('top-secret');
    expect(new Headers(init?.headers).get('api-key')).toBe('top-secret');
  });

  it('writes to the versioned physical collection and sweeps only owned versions during erasure', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(
        ok({
          collections: [{ name: 'search_active_v1_1' }, { name: 'search_active_v2_1' }, { name: 'unrelated_collection' }],
        }),
      )
      .mockImplementation(async () => ok({}));
    const client = new QdrantClient({
      url: 'https://qdrant.test',
      alias: 'search_active',
      schemaVersion: 'v2',
      vectorSize: 1,
      fetch: request,
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

    expect(String(request.mock.calls[0]?.[0])).toContain('/collections/search_active_v2_1/points');
    const deletionUrls = request.mock.calls.slice(2).map(([url]) => String(url));
    expect(deletionUrls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/collections/search_active_v1_1/points/delete'),
        expect.stringContaining('/collections/search_active_v2_1/points/delete'),
      ]),
    );
    expect(JSON.stringify(deletionUrls)).not.toContain('unrelated_collection');
  });

  it('fails before I/O when counts, deletes, or retrieval omit mandatory tenant scope', async () => {
    const request = vi.fn<typeof fetch>();
    const client = new QdrantClient({ url: 'https://qdrant.test', fetch: request, vectorSize: 1 });
    await expect(client.count({ must: [] })).rejects.toThrow('project_id');
    await expect(client.deleteByFilter({ must: [{ key: 'deployment_id', match: { value: 'dep' } }] })).rejects.toThrow('project_id');
    await expect(
      client.queryHybrid({
        dense: [0.1],
        sparse: { indices: [1], values: [1] },
        filter: { must: [{ key: 'project_id', match: { value: 'tenant-a' } }] },
        idfCorpus: { must: [{ key: 'project_id', match: { value: 'tenant-a' } }] },
        limit: 1,
      }),
    ).rejects.toThrow('deployment_id');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a broader IDF corpus so unauthorized pages cannot affect scores', async () => {
    const request = vi.fn<typeof fetch>();
    const client = new QdrantClient({ url: 'https://qdrant.test', fetch: request, vectorSize: 1 });
    const filter: QdrantFilter = {
      must: [
        { key: 'project_id', match: { value: 'tenant-a' } },
        { key: 'deployment_id', match: { value: 'dep' } },
        { key: 'version_slug', match: { value: 'main' } },
        { key: 'language', match: { value: 'en' } },
        { key: 'visibility', match: { value: 'private' } },
        { key: 'visible', match: { value: true } },
        { key: 'page_id', match: { any: ['allowed'] } },
      ],
    };
    await expect(
      client.queryHybrid({
        dense: [0.1],
        sparse: { indices: [1], values: [1] },
        filter,
        idfCorpus: { must: filter.must.filter((condition) => condition.key !== 'page_id') },
        limit: 1,
      }),
    ).rejects.toThrow('IDF corpus');
    expect(request).not.toHaveBeenCalled();
  });
});
