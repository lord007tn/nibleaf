import { afterAll, describe, expect, it } from 'vitest';
import { QdrantClient, type QdrantFilter, type QdrantPoint } from './client';

const url = process.env.QDRANT_INTEGRATION_URL;
const alias = `nibleaf_search_it_${process.pid}_${Date.now()}`;
const client = url ? new QdrantClient({ url, alias, schemaVersion: 'v1', vectorSize: 4, timeoutMs: 10_000 }) : null;

const filter = (projectId: string, pageId: string): QdrantFilter => ({
  must: [
    { key: 'project_id', match: { value: projectId } },
    { key: 'deployment_id', match: { value: 'deployment-a' } },
    { key: 'version_slug', match: { value: 'main' } },
    { key: 'language', match: { value: 'ar' } },
    { key: 'visibility', match: { value: 'private' } },
    { key: 'visible', match: { value: true } },
    { key: 'page_id', match: { any: [pageId] } },
  ],
});

const point = (id: string, projectId: string, pageId: string, content: string): QdrantPoint => ({
  id,
  vector: { dense: [1, 0, 0, 0], bm25: { indices: [42], values: [1] } },
  payload: {
    project_id: projectId,
    deployment_id: 'deployment-a',
    version_slug: 'main',
    language: 'ar',
    visibility: 'private',
    visible: true,
    page_id: pageId,
    ordinal: 0,
    title: 'خاص',
    path: pageId,
    description: '',
    heading: '',
    heading_path: [],
    content,
    content_hash: `${projectId}-${pageId}`,
    direction: 'rtl',
  },
});

describe.skipIf(!client)('Qdrant live tenant isolation', () => {
  afterAll(async () => {
    if (url && client) await fetch(`${url}/collections/${encodeURIComponent(client.collection)}`, { method: 'DELETE' });
  });

  it('creates a versioned hybrid collection and isolates retrieval, counts, IDF, and deletion', async () => {
    if (!client) throw new Error('QDRANT_INTEGRATION_URL is required for this test.');
    await client.ensureHybridCollection();
    await client.upsert([
      point('11111111-1111-5111-a111-111111111111', 'tenant-a', 'page-a', 'محتوى المستأجر الأول'),
      point('22222222-2222-5222-a222-222222222222', 'tenant-b', 'page-b', 'محتوى المستأجر الثاني'),
    ]);
    const tenantA = filter('tenant-a', 'page-a');
    const result = await client.queryHybrid({
      dense: [1, 0, 0, 0],
      sparse: { indices: [42], values: [1] },
      filter: tenantA,
      idfCorpus: tenantA,
      limit: 5,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.payload).toMatchObject({ project_id: 'tenant-a', page_id: 'page-a' });
    expect(JSON.stringify(result)).not.toContain('tenant-b');
    expect(await client.count({ must: [{ key: 'project_id', match: { value: 'tenant-a' } }] })).toBe(1);
    expect(await client.count({ must: [{ key: 'project_id', match: { value: 'tenant-b' } }] })).toBe(1);

    await client.deleteByFilter({ must: [{ key: 'project_id', match: { value: 'tenant-a' } }] });
    expect(await client.count({ must: [{ key: 'project_id', match: { value: 'tenant-a' } }] })).toBe(0);
    expect(await client.count({ must: [{ key: 'project_id', match: { value: 'tenant-b' } }] })).toBe(1);
  }, 15_000);
});
