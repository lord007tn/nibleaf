import type { QdrantScoredPoint } from '@nibleaf/qdrant';
import { chunkSearchDocument, type SearchScope } from '@nibleaf/search';
import { describe, expect, it } from 'vitest';
import { chunkFromPoint, filterForSearchScope, pagesToWiden, retrieveChatContext } from './runtime';

const scope = (projectId = 'tenant-a', pages: string[] | null = ['page-a']): SearchScope => ({
  projectId,
  deploymentId: 'deployment-a',
  versionSlug: 'main',
  language: 'ar',
  visibility: 'private',
  allowedPageIds: pages === null ? null : new Set(pages),
});

const point = (overrides: Record<string, unknown> = {}): QdrantScoredPoint => ({
  id: 'chunk-a',
  score: 0.8,
  payload: {
    project_id: 'tenant-a',
    deployment_id: 'deployment-a',
    version_slug: 'main',
    language: 'ar',
    visibility: 'private',
    visible: true,
    page_id: 'page-a',
    ordinal: 0,
    title: 'خاص',
    path: 'private',
    description: '',
    heading: '',
    heading_path: [],
    content: 'محتوى مصرح',
    content_hash: 'hash',
    direction: 'rtl',
    ...overrides,
  },
});

describe('reading the rest of pages that appear only thinly', () => {
  const hit = (id: string, pageId: string, score = 0.5) => ({ chunk: { id, pageId, title: `Page ${pageId}`, content: id } as never, score });
  it('widens the best-ranked pages, at most two, that have one or two sections among the results', () => {
    expect(pagesToWiden([hit('c1', 'export')])).toEqual([{ id: 'export', title: 'Page export' }]);
    // A sync section ranked first among other pages' sections (several pages, one of them thin).
    expect(
      pagesToWiden([hit('s1', 'sync'), hit('e1', 'export'), hit('e2', 'export'), hit('e3', 'export'), hit('i1', 'install')]).map((page) => page.id),
    ).toEqual(['sync']);
    expect(pagesToWiden([hit('s1', 'sync'), hit('i1', 'install'), hit('e1', 'export')]).map((page) => page.id)).toEqual(['sync', 'install']);
    expect(pagesToWiden([hit('c1', 'export'), hit('c2', 'export'), hit('c1', 'export')]).map((page) => page.id)).toEqual(['export']);
    expect(pagesToWiden([])).toEqual([]);
  });

  type Search = NonNullable<Parameters<typeof retrieveChatContext>[4]>;
  const runtime = {} as never;
  const searchScope = { ...scope('tenant-a', null), visibility: 'public' as const };
  /** A stub search: the main lane finds `main`; a page lane finds that page's `sections`. */
  const stub = (main: ReturnType<typeof hit>[], sections: Record<string, ReturnType<typeof hit>[]>) => {
    const calls: { pages: string[] | null; query: string; limit: number }[] = [];
    const search: Search = async (target, query, limit) => {
      const pages = target.allowedPageIds ? [...target.allowedPageIds] : null;
      calls.push({ pages, query, limit });
      const chunks = pages ? (sections[pages[0] ?? ''] ?? []) : main;
      return { cacheHit: false, chunks, confidence: pages ? 0.9 : 0.3 };
    };
    return { search, calls };
  };

  it('searches only the thin page for its other sections, keeping the main confidence', async () => {
    const { search, calls } = stub([hit('s-conflict', 'sync', 0.54), hit('e1', 'export'), hit('e2', 'export'), hit('e3', 'export')], {
      sync: [hit('s-token', 'sync', 0.4), hit('s-doctor', 'sync', 0.3)],
    });
    const result = await retrieveChatContext(searchScope, 'notes missing on my phone', runtime, {}, search);
    expect(calls.map((call) => call.pages)).toEqual([null, ['sync']]);
    expect(calls[1]).toMatchObject({ query: 'Page sync notes missing on my phone', limit: 6 });
    expect(result.chunks.map((chunk) => chunk.id)).toEqual(expect.arrayContaining(['s-conflict', 's-token', 's-doctor']));
    // A widened page is not a page the reader chose: its confidence is not raised.
    expect(result.confidence).toBe(0.3);
  });

  it('reads the page the reader asked from instead, and only it', async () => {
    const { search, calls } = stub([hit('s-conflict', 'sync')], { export: [hit('e-steps', 'export')] });
    const result = await retrieveChatContext(searchScope, 'how?', runtime, { page: { id: 'export', title: 'Export' } }, search);
    expect(calls.map((call) => call.pages)).toEqual([null, ['export']]);
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('never reads a page outside the reader’s grants', async () => {
    const { search, calls } = stub([hit('a1', 'page-a')], {});
    await retrieveChatContext(scope('tenant-a', ['page-a']), 'how?', runtime, { page: { id: 'page-b', title: 'B' } }, search);
    expect(calls.every((call) => call.pages === null || call.pages.every((page) => page === 'page-a'))).toBe(true);
  });
});

describe('server-derived Qdrant scope', () => {
  it('requires tenant, deployment, version, language, visibility, visible, and page grants', () => {
    const filter = filterForSearchScope(scope());
    expect(filter?.must).toEqual(
      expect.arrayContaining([
        { key: 'project_id', match: { value: 'tenant-a' } },
        { key: 'deployment_id', match: { value: 'deployment-a' } },
        { key: 'version_slug', match: { value: 'main' } },
        { key: 'language', match: { value: 'ar' } },
        { key: 'visibility', match: { value: 'private' } },
        { key: 'visible', match: { value: true } },
        { key: 'page_id', match: { any: ['page-a'] } },
      ]),
    );
  });

  it('short-circuits a reader with no effective page grant', () => {
    expect(filterForSearchScope(scope('tenant-a', []))).toBeNull();
  });

  it.each([
    ['another tenant', { project_id: 'tenant-b' }],
    ['another deployment', { deployment_id: 'deployment-b' }],
    ['another language', { language: 'en' }],
    ['public/private mismatch', { visibility: 'public' }],
    ['hidden content', { visible: false }],
    ['unauthorized page', { page_id: 'page-b' }],
  ])('rejects %s payloads after retrieval', (_label, overrides) => {
    expect(chunkFromPoint(point(overrides), scope())).toBeNull();
  });

  it('returns only the authorized chunk and preserves RTL direction', () => {
    expect(chunkFromPoint(point(), scope())).toMatchObject({ chunk: { pageId: 'page-a', direction: 'rtl' }, score: 0.8 });
  });

  it('accepts serialized chunks from a page that begins with a second-level heading', () => {
    const [chunk] = chunkSearchDocument(scope(), {
      id: 'page-a',
      title: 'الإعداد',
      path: 'setup',
      description: '',
      headings: [],
      content: '## إعداد API_URL\n\nاستخدم API_URL=http://localhost:4311.',
      language: 'ar',
      visible: true,
    });
    expect(chunk).toBeDefined();
    const storedPath: unknown = JSON.parse(JSON.stringify(chunk?.headingPath));
    expect(chunkFromPoint(point({ heading_path: storedPath }), scope())).toMatchObject({
      chunk: { headingPath: ['إعداد API_URL'] },
    });
  });
});
