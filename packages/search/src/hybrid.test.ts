import { describe, expect, it } from 'vitest';
import {
  chunkSearchDocument,
  hybridTokens,
  registerSearchTokenAdapter,
  rerankHybridChunks,
  type SearchScope,
  searchCacheKey,
  sparseVectorForChunk,
  sparseVectorForQuery,
} from './hybrid';

const scope = (projectId: string, pages: string[] | null = null): SearchScope => ({
  projectId,
  deploymentId: 'deployment-1',
  versionSlug: 'main',
  language: 'ar',
  visibility: 'private',
  allowedPageIds: pages === null ? null : new Set(pages),
});

describe('hybrid multilingual retrieval primitives', () => {
  it('normalizes Arabic morphology, stems English, and preserves mixed technical identifiers', () => {
    const tokens = hybridTokens('إعدادات users API_URL v2.1');
    expect(tokens).toContain('اعداد');
    expect(tokens).toContain('user');
    expect(tokens).toContain('api_url');
    expect(tokens).toContain('v2.1');
  });

  it('shares typo trigrams and exposes a later-language token adapter boundary', () => {
    const query = sparseVectorForQuery('configuraton');
    const [chunk] = chunkSearchDocument(scope('tenant-a'), {
      id: 'typo',
      title: 'Configuration',
      path: 'configuration',
      description: '',
      headings: [],
      content: 'Configuration reference.',
      language: 'en',
      visible: true,
    });
    if (!chunk) throw new Error('fixture did not produce a chunk');
    const document = sparseVectorForChunk(chunk);
    expect(query.indices.filter((index) => document.indices.includes(index)).length).toBeGreaterThan(2);
    registerSearchTokenAdapter('xx', (token) => [`xx:${token}`]);
    expect(hybridTokens('example', 'xx')).toEqual(['xx:example']);
  });

  it('chunks on headings, preserves fenced code, marks RTL, and produces deterministic ids', () => {
    const source = {
      id: 'page-1',
      title: 'الإعداد',
      path: 'setup',
      description: 'دليل',
      headings: ['التثبيت'],
      content: '## التثبيت\n\nشغّل الأمر:\n\n```bash\npnpm dev\n```\n\nثم افتح المتصفح.',
      language: 'ar',
      visible: true,
    };
    const first = chunkSearchDocument(scope('tenant-a'), source, { maxChars: 80, overlapChars: 10 });
    const second = chunkSearchDocument(scope('tenant-a'), source, { maxChars: 80, overlapChars: 10 });
    expect(first).toEqual(second);
    expect(first[0]?.direction).toBe('rtl');
    expect(first.map((chunk) => chunk.content).join('\n')).toContain('pnpm dev');
    expect(new Set(first.map((chunk) => chunk.id)).size).toBe(first.length);
  });

  it('weights title/headings/code in a stable sparse representation', () => {
    const [chunk] = chunkSearchDocument(scope('tenant-a'), {
      id: 'page',
      title: 'API reference',
      path: 'api',
      description: '',
      headings: ['Headers'],
      content: 'Use API_URL and Authorization headers.',
      language: 'en',
      visible: true,
    });
    if (!chunk) throw new Error('fixture did not produce a chunk');
    const vector = sparseVectorForChunk(chunk);
    expect(vector.indices).toEqual([...vector.indices].sort((a, b) => a - b));
    expect(vector.values.every((value) => value > 0)).toBe(true);
  });

  it('deterministically reranks exact phrases, headings, and code symbols after fusion', () => {
    const [generic] = chunkSearchDocument(scope('tenant-a'), {
      id: 'generic',
      title: 'Development',
      path: 'development',
      description: '',
      headings: [],
      content: 'Configure a local server.',
      language: 'en',
      visible: true,
    });
    const [exact] = chunkSearchDocument(scope('tenant-a'), {
      id: 'exact',
      title: 'API_URL setup',
      path: 'api',
      description: '',
      headings: ['Environment'],
      content: 'Set API_URL for local development.',
      language: 'en',
      visible: true,
    });
    if (!generic || !exact) throw new Error('fixtures did not produce chunks');
    const ranked = rerankHybridChunks('API_URL setup', [
      { chunk: generic, score: 0.6 },
      { chunk: exact, score: 0.5 },
    ]);
    expect(ranked[0]?.chunk.pageId).toBe('exact');
    expect(rerankHybridChunks('API_URL setup', ranked)).toEqual(rerankHybridChunks('API_URL setup', ranked));
  });
});

describe('authorization-scoped cache keys', () => {
  it('cannot share entries across tenants, visibility, deployments, or page grants', () => {
    const base = searchCacheKey(scope('tenant-a', ['page-a']), 'setup');
    expect(searchCacheKey(scope('tenant-b', ['page-a']), 'setup')).not.toBe(base);
    expect(searchCacheKey(scope('tenant-a', ['page-b']), 'setup')).not.toBe(base);
    expect(searchCacheKey({ ...scope('tenant-a', ['page-a']), deploymentId: 'deployment-2' }, 'setup')).not.toBe(base);
    expect(searchCacheKey({ ...scope('tenant-a', ['page-a']), visibility: 'public' }, 'setup')).not.toBe(base);
  });
});
