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
  const ids = (pages: { id: string }[]) => pages.map((page) => page.id);
  it('chooses thin pages among the best results by score, at most two', () => {
    expect(pagesToWiden([hit('c1', 'export')])).toEqual([{ id: 'export', title: 'Page export', best: 0.5 }]);
    // The sync page ranked third, behind two pages with several sections each.
    const third = [
      hit('e1', 'export', 0.6),
      hit('e2', 'export', 0.59),
      hit('e3', 'export', 0.58),
      hit('t1', 'tour', 0.57),
      hit('t2', 'tour', 0.56),
      hit('t3', 'tour', 0.55),
      hit('s1', 'sync', 0.54),
    ];
    expect(ids(pagesToWiden(third))).toEqual(['sync']);
    expect(ids(pagesToWiden([hit('i1', 'install', 0.2), hit('s1', 'sync', 0.5), hit('x1', 'other', 0.3)]))).toEqual(['sync', 'other']);
    // A thin page only past the best results is not read.
    const late = [...Array.from({ length: 8 }, (_, index) => hit(`e${index}`, `page-${index % 3}`, 0.9 - index / 100)), hit('s1', 'sync', 0.4)];
    expect(ids(pagesToWiden(late))).not.toContain('sync');
    expect(pagesToWiden([])).toEqual([]);
  });

  type Search = NonNullable<Parameters<typeof retrieveChatContext>[4]>;
  const runtime = {} as never;
  const searchScope = { ...scope('tenant-a', null), visibility: 'public' as const };
  /** A stub search: the main lane finds `main`; a page lane finds that page's `sections`. */
  const stub = (main: ReturnType<typeof hit>[], sections: Record<string, ReturnType<typeof hit>[]>, confidence = 0.3) => {
    const calls: { pages: string[] | null; query: string; limit: number }[] = [];
    const search: Search = async (target, query, limit) => {
      const pages = target.allowedPageIds ? [...target.allowedPageIds] : null;
      calls.push({ pages, query, limit });
      const chunks = pages ? (sections[pages[0] ?? ''] ?? []) : main;
      return { cacheHit: false, chunks, confidence: pages ? 0.9 : confidence };
    };
    return { search, calls };
  };

  it('adds a thin page’s other sections without letting them outrank stronger results', async () => {
    // The Arabic phone question: export ranks first; install and sync each matched once.
    const { search, calls } = stub(
      [hit('e1', 'export', 0.3), hit('e2', 'export', 0.29), hit('e3', 'export', 0.28), hit('i1', 'install', 0.167), hit('s1', 'sync', 0.143)],
      {
        install: [hit('i-overview', 'install', 1.08), hit('i-steps', 'install', 1.0)],
        sync: [hit('s-token', 'sync', 0.9), hit('s-doctor', 'sync', 0.8)],
      },
    );
    const result = await retrieveChatContext(searchScope, 'notes missing on my phone', runtime, {}, search);
    expect(calls.map((call) => call.pages)).toEqual([null, ['install'], ['sync']]);
    expect(calls[2]).toMatchObject({ query: 'Page sync notes missing on my phone', limit: 6 });
    const order = result.hits.map((item) => item.chunk.id);
    // Stronger results stay first; each widened section sits under its page's own best result.
    expect(order.slice(0, 3)).toEqual(['e1', 'e2', 'e3']);
    expect(order).toEqual(expect.arrayContaining(['s-token', 's-doctor']));
    expect(order.indexOf('i-overview')).toBeGreaterThan(order.indexOf('e3'));
    expect(order.indexOf('s-token')).toBeGreaterThan(order.indexOf('i-steps'));
    for (const item of result.hits) if (item.chunk.id.startsWith('s-')) expect(item.score).toBeLessThan(0.143);
    // A widened page is not a page the reader chose: its confidence is not raised.
    expect(result.confidence).toBe(0.3);
  });

  it('reads nothing more for a turn below the answer threshold', async () => {
    const { search, calls } = stub([hit('s1', 'sync', 0.05)], { sync: [hit('s-token', 'sync', 0.9)] }, 0.05);
    await retrieveChatContext(searchScope, 'how?', runtime, {}, search);
    expect(calls.map((call) => call.pages)).toEqual([null]);
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
