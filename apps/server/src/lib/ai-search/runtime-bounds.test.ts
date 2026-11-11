import type { SearchScope } from '@nibleaf/search';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), embed: vi.fn() }));
vi.mock('@nibleaf/qdrant', () => ({ getQdrantClient: () => ({ vectorSize: 2, queryHybrid: mocks.query }) }));
vi.mock('@nibleaf/database', () => ({ prisma: {} }));
vi.mock('@nibleaf/search/workspace', () => ({
  workspaceEmbeddingProvider: () => ({ model: 'fixture', dimensions: 2, embed: mocks.embed }),
}));
vi.mock('@/env', () => ({
  env: {
    SEARCH_CACHE_TTL_MS: 0,
    SEARCH_CANDIDATE_LIMIT: 48,
    SEARCH_DENSE_MIN_SCORE: 0.35,
    SEARCH_ANSWER_MIN_CONFIDENCE: 0.2,
    QDRANT_COLLECTION_VERSION: 'test',
  },
}));

import { type ChatLanguageContext, retrieveChatLanguages } from './runtime';

const scope: SearchScope = {
  projectId: 'site-a',
  deploymentId: 'deploy-a',
  versionSlug: 'v2',
  language: 'ar',
  visibility: 'private',
  allowedPageIds: new Set(['en-1', 'en-2', 'ar-1', 'ar-2', 'weak']),
};
const page = (language: string, index: number) => ({
  id: `${language}-${index}`,
  title: 'Guide',
  path: `${language}/${index}`,
  translationKey: `guide-${index}`,
  languageCode: language,
  kind: 'PAGE' as const,
  hidden: false,
});
const point = (language: string, id: string, score: number, overrides = {}) => ({
  id: `${language}-${id}`,
  score,
  payload: {
    project_id: 'site-a',
    organization_id: 'same-org',
    deployment_id: 'deploy-a',
    version_slug: 'v2',
    language,
    visibility: 'private',
    visible: true,
    page_id: id,
    ordinal: 0,
    title: 'Guide',
    path: id,
    content: 'Instructions',
    content_hash: 'hash',
    direction: 'ltr',
    ...overrides,
  },
});
const filter = (language: string, ids: string[]) => ({
  must: [
    { key: 'project_id', match: { value: 'site-a' } },
    { key: 'deployment_id', match: { value: 'deploy-a' } },
    { key: 'version_slug', match: { value: 'v2' } },
    { key: 'language', match: { value: language } },
    { key: 'visibility', match: { value: 'private' } },
    { key: 'visible', match: { value: true } },
    { key: 'page_id', match: { any: [...ids].sort() } },
  ],
});
const languageOf = (input: { filter: ReturnType<typeof filter> }) => {
  const value = input.filter.must.find((clause) => clause.key === 'language')?.match.value;
  return typeof value === 'string' ? value : 'ar';
};
const pagesOf = (input: { filter: ReturnType<typeof filter> }) => input.filter.must.find((clause) => clause.key === 'page_id')?.match.any ?? [];
const context = (count = 2): ChatLanguageContext => ({
  languages: ['ar', 'en', ...Array.from({ length: count - 2 }, (_, index) => `language-${index}`)],
  defaultLanguage: 'en',
  pages: [page('en', 1), page('en', 2), page('ar', 1), page('ar', 2)],
});
const retrieve = (ctx = context(), target = scope) => retrieveChatLanguages(target, `question-${counter++}`, {} as never, ctx, { language: 'ar' });
let counter = 0;

describe('bounded retrieval at the real Qdrant boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.embed.mockResolvedValue({ vectors: [[1, 0]] });
    mocks.query.mockImplementation(async (input) => {
      const language = languageOf(input);
      const ids = pagesOf(input);
      if (language === 'ar' && ids.length === 1) return [point('ar', ids[0] ?? '', 0.8)];
      if (language === 'en') return [point('en', 'en-1', 0.5), point('en', 'en-2', 0.5)];
      return [point(language ?? 'ar', 'weak', 0.001)];
    });
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    [2, 4],
    [30, 5],
  ])('bounds %i languages to %i calls and one embedding', async (count, expected) => {
    let active = 0;
    let peak = 0;
    const implementation = mocks.query.getMockImplementation();
    mocks.query.mockImplementation(async (...args) => {
      active++;
      peak = Math.max(peak, active);
      try {
        return await implementation?.(...args);
      } finally {
        active--;
      }
    });
    const result = await retrieve(context(count));
    expect(mocks.query).toHaveBeenCalledTimes(expected);
    expect(mocks.embed).toHaveBeenCalledTimes(1);
    expect(peak).toBeLessThanOrEqual(2);
    expect(result.chunks.map((chunk) => chunk.pageId)).toEqual(['ar-1', 'ar-2']);
    const calls = mocks.query.mock.calls.map(([input]) => input);
    expect(calls[0].filter).toEqual(filter('ar', [...(scope.allowedPageIds ?? [])]));
    expect(calls[1].filter).toEqual(filter('en', [...(scope.allowedPageIds ?? [])]));
    expect(calls.slice(-2).map((input) => input.filter)).toEqual([filter('ar', ['ar-1']), filter('ar', ['ar-2'])]);
    for (const input of calls) {
      expect(input.idfCorpus).toEqual(input.filter);
      expect(input.dense).toEqual([1, 0]);
      expect(input.sparse.indices.length).toBeGreaterThan(0);
    }
  });

  it('chooses the default then the most populated published fallback, without widening either', async () => {
    const ctx = context(30);
    ctx.pages.push(...Array.from({ length: 8 }, (_, index) => page('language-7', index)));
    await retrieve(ctx, { ...scope, allowedPageIds: null });
    expect(mocks.query.mock.calls.map(([input]) => languageOf(input)).slice(0, 3)).toEqual(['ar', 'en', 'language-7']);
  });

  it('reuses the question embedding for both primary widening calls', async () => {
    mocks.query.mockImplementation(async (input) =>
      pagesOf(input).length === 1 ? [point('ar', pagesOf(input)[0] ?? '', 0.8)] : [point('ar', 'ar-1', 0.5), point('ar', 'ar-2', 0.5)],
    );
    await retrieve();
    expect(mocks.query).toHaveBeenCalledTimes(3);
    expect(mocks.embed).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls.every(([input]) => languageOf(input) === 'ar')).toBe(true);
  });

  it.each([{ project_id: 'sibling-site-in-same-org' }, { deployment_id: 'old-deploy' }, { version_slug: 'wrong-version' }])(
    'revalidates fallback and translation payloads: %j',
    async (badScope) => {
      const implementation = mocks.query.getMockImplementation();
      mocks.query.mockImplementation(async (input) => [
        ...((await implementation?.(input)) ?? []),
        point(languageOf(input) ?? 'ar', pagesOf(input)[0] ?? 'weak', 100, badScope),
      ]);
      const result = await retrieve();
      expect(result.hits.every((hit) => hit.score < 100)).toBe(true);
      for (const [input] of mocks.query.mock.calls) expect(input.filter).toEqual(filter(languageOf(input) ?? 'ar', pagesOf(input)));
    },
  );

  it('never requests a forbidden translation or disabled language', async () => {
    const target = { ...scope, allowedPageIds: new Set(['en-1', 'en-2', 'ar-1', 'weak']) };
    await retrieve({ ...context(), pages: [...context().pages, page('fa', 1)] }, target);
    expect(mocks.query.mock.calls.filter(([input]) => pagesOf(input).length === 1).map(([input]) => input.filter)).toEqual([filter('ar', ['ar-1'])]);
    expect(mocks.query.mock.calls.some(([input]) => languageOf(input) === 'fa')).toBe(false);
    vi.clearAllMocks();
    mocks.query.mockResolvedValue([]);
    await retrieve({ ...context(), languages: ['en'] });
    expect(mocks.query.mock.calls.every(([input]) => languageOf(input) === 'en')).toBe(true);
  });

  it('returns completed partial results at the shared deadline even if a lane ignores abort', async () => {
    vi.useFakeTimers();
    const implementation = mocks.query.getMockImplementation();
    const signals: AbortSignal[] = [];
    mocks.query.mockImplementation((input, signal) => {
      signals.push(signal);
      return languageOf(input) === 'en'
        ? new Promise(() => {
            /* Deliberately ignores cancellation. */
          })
        : implementation?.(input);
    });
    let finished = false;
    const work = retrieve().then((result) => {
      finished = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(7999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await work).chunks[0]?.pageId).toBe('weak');
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(new Set(signals).size).toBe(1);
    expect(mocks.embed.mock.calls[0]?.[1]).toBe(signals[0]);
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.embed).toHaveBeenCalledTimes(1);
    expect(mocks.embed.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('includes embedding time in the same deadline', async () => {
    vi.useFakeTimers();
    let finishEmbedding: ((value: { vectors: number[][] }) => void) | undefined;
    mocks.embed.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishEmbedding = resolve;
        }),
    );
    const work = retrieve();
    await vi.advanceTimersByTimeAsync(8000);
    expect((await work).chunks).toEqual([]);
    expect(mocks.embed).toHaveBeenCalledTimes(1);
    expect(mocks.query).not.toHaveBeenCalled();
    finishEmbedding?.({ vectors: [[1, 0]] });
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('propagates reader cancellation instead of converting it to a partial success', async () => {
    const controller = new AbortController();
    mocks.query.mockImplementation(
      () =>
        new Promise(() => {
          /* Deliberately ignores cancellation. */
        }),
    );
    const work = retrieveChatLanguages(scope, `cancel-${counter++}`, {} as never, context(), { language: 'ar', signal: controller.signal });
    const rejected = expect(work).rejects.toThrow('reader stopped');
    controller.abort(new Error('reader stopped'));
    await rejected;
  });
});
