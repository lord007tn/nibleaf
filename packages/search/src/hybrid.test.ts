import { describe, expect, it } from 'vitest';
import {
  chunkSearchDocument,
  collapseChunkHits,
  hybridTokens,
  registerSearchTokenAdapter,
  rerankHybridChunks,
  type SearchScope,
  searchCacheKey,
  selectAnswerChunks,
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
    expect(first[0]?.headingPath).toEqual(['التثبيت']);
    expect(first.map((chunk) => chunk.content).join('\n')).toContain('pnpm dev');
    expect(new Set(first.map((chunk) => chunk.id)).size).toBe(first.length);
  });

  it('keeps skipped heading levels serializable without null ancestors', () => {
    const chunks = chunkSearchDocument(scope('tenant-a'), {
      id: 'headings',
      title: 'Guide',
      path: 'guide',
      description: '',
      headings: [],
      content: '## Setup\n\nFirst.\n\n#### API_URL\n\nSecond.\n\n### Run\n\nThird.\n\n## Next\n\nFourth.',
      language: 'en',
      visible: true,
    });
    expect(chunks.map((chunk) => JSON.parse(JSON.stringify(chunk.headingPath)))).toEqual([
      ['Setup'],
      ['Setup', 'API_URL'],
      ['Setup', 'Run'],
      ['Next'],
    ]);
  });

  it('retains definitions written entirely in adjacent headings', () => {
    const chunks = chunkSearchDocument(scope('tenant-a'), {
      id: 'definitions',
      title: 'Booking modes',
      path: 'booking-modes',
      description: '',
      headings: [],
      content:
        '## Automatic mode confirms bookings without approval.\n\n## Manual mode requires approval for every booking.\n\nChoose the mode when creating an allocation.',
      language: 'en',
      visible: true,
    });
    expect(chunks.find((chunk) => chunk.heading.startsWith('Automatic mode'))?.content).toContain('confirms bookings without approval');
    expect(chunks.find((chunk) => chunk.heading.startsWith('Manual mode'))?.heading).toContain('requires approval for every booking');
    expect(chunks.map((chunk) => chunk.content).join('\n')).toContain('Choose the mode when creating an allocation.');
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

describe('documentation passage selection', () => {
  const chunks = (pageId: string, content: string) =>
    chunkSearchDocument(
      scope('tenant-a'),
      {
        id: pageId,
        title: pageId,
        path: pageId,
        description: '',
        headings: [],
        content,
        language: 'ar',
        visible: true,
      },
      { maxChars: 100, overlapChars: 10 },
    );

  it('shows the matching Arabic passage and keeps technical identifiers from fenced code', () => {
    const [chunk] = chunkSearchDocument(scope('tenant-a'), {
      id: 'api',
      title: 'API setup',
      path: 'api',
      description: '',
      headings: [],
      content: `${'Introductory context. '.repeat(20)}\n\n\`\`\`sh\nAPI_URL=http://localhost:4311\n\`\`\`\n\nإعدادات الحجوزات والغرف.`,
      language: 'ar',
      visible: true,
    });
    if (!chunk) throw new Error('Missing fixture');
    const snippet = collapseChunkHits([{ chunk, score: 1 }], 1, 'API_URL الحجوزات')[0]?.snippet;
    expect(snippet).toContain('API_URL');
    expect(snippet).toContain('الحجوزات');
    expect(snippet?.length).toBeLessThanOrEqual(240);
    expect(snippet).not.toContain('```');
  });

  it('reserves space for independent sources and fills remaining capacity without duplicates', () => {
    const long = chunks('long-page', 'معلومات الحجوزات والغرف. '.repeat(60));
    const other = chunks('another-page', 'إلغاء الحجز.');
    const third = chunks('third-page', 'إضافة عميل.');
    const hits = [...long, ...other, ...third].map((chunk, index) => ({ chunk, score: 1 - index / 100 }));
    expect(selectAnswerChunks(hits, 3).map((chunk) => chunk.pageId)).toEqual(['long-page', 'another-page', 'third-page']);
    const selected = selectAnswerChunks(hits, 5);
    expect(selected).toHaveLength(5);
    expect(new Set(selected.map((chunk) => chunk.id)).size).toBe(5);
    expect(
      selectAnswerChunks(
        hits.filter(({ chunk }) => chunk.pageId === 'long-page'),
        3,
      ),
    ).toHaveLength(3);
  });

  it('keeps complementary definitions ahead of lower-ranked independent pages', () => {
    const normal = chunks(
      'basic-contract',
      '## Block\n\nFixed rooms each day, already confirmed.\n\n## Overview\n\nCreate a basic contract.\n\n## Nights\n\nA fixed night balance needs confirmation.\n\n## Save\n\nSave the contract.',
    );
    const advanced = chunks(
      'advanced-contract',
      '## Overview\n\nChoose a contract type.\n\n## Block\n\nFixed rooms each day, already confirmed.\n\n## Nights\n\nA fixed total of nights requires confirmation for each booking.\n\n## Note\n\nThe last day is checkout.',
    );
    const independent = ['comparison', 'pricing', 'company', 'appendix'].flatMap((page) => chunks(page, 'Related reference.'));
    const ordered = [
      normal[0],
      advanced[0],
      advanced[1],
      normal[1],
      advanced[2],
      independent[0],
      advanced[3],
      normal[2],
      independent[1],
      normal[3],
      independent[2],
      independent[3],
    ];
    const hits = ordered.map((chunk, index) => {
      if (!chunk) throw new Error('Missing comparative source fixture');
      return { chunk, score: 0.8 - index * 0.05 };
    });
    const selected = selectAnswerChunks(hits);
    expect(selected).toContain(advanced[2]);
    expect(selected).toContain(advanced[1]);
    expect(selected).toHaveLength(8);
    expect(new Set(selected.map((chunk) => chunk.id)).size).toBe(8);
    expect(new Set(selected.map((chunk) => chunk.pageId))).toEqual(
      new Set(['basic-contract', 'advanced-contract', 'comparison', 'pricing', 'company']),
    );
  });
});
