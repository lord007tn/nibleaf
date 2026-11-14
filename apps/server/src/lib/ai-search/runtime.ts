import { createLogger } from '@nibleaf/logger';
import { getQdrantClient, type QdrantFilter, type QdrantScoredPoint } from '@nibleaf/qdrant';
import {
  collapseChunkHits,
  type GroundedAnswer,
  generateGroundedAnswer,
  type HybridChunkHit,
  oramaLanguageForCode,
  questionLanguage,
  readerRelevanceFloor,
  readerRelevanceScore,
  readerSearchFields,
  readerSearchTerms,
  rerankHybridChunks,
  retrievalConfidence,
  type SearchChunk,
  type SearchHit,
  type SearchScope,
  searchCacheKey,
  selectAnswerChunks,
  sparseVectorForQuery,
} from '@nibleaf/search';
import { resolveWorkspaceAi, type WorkspaceAiRuntime, workspaceAnswerProvider, workspaceEmbeddingProvider } from '@nibleaf/search/workspace';
import { isPageTranslation, type SnapshotPage } from '@nibleaf/shared/site';
import { z } from 'zod';
import { env } from '@/env';
import type { SectionResolver } from '@/lib/ai-search/sections';
import { LruCache, TtlCache } from '@/lib/lru';
import { configuredIndexServing, findCurrentIndexRun, indexRunServesAnswers } from './readiness';

const log = createLogger({ component: 'ai-search' });
const retrievalCache = new TtlCache<string, HybridChunkHit[]>(500, env.SEARCH_CACHE_TTL_MS);
const answerCache = new TtlCache<string, GroundedAnswer>(250, env.SEARCH_CACHE_TTL_MS);
const qdrant = getQdrantClient();
const keywordAnswerHints = new LruCache<string, { available: boolean; at: number; refreshing: boolean }>(500);

/** A UI hint only. Cold/expired hints are false until a background readiness
 * check completes; the answer/chat endpoints still check live state themselves. */
export const publishedSearchAnswerHint = (projectId: string, deploymentId: string): boolean => {
  const key = JSON.stringify([projectId, deploymentId]);
  let hint = keywordAnswerHints.get(key);
  if (!hint) {
    hint = { available: false, at: 0, refreshing: false };
    keywordAnswerHints.set(key, hint);
  }
  if (Date.now() - hint.at > 5000 && !hint.refreshing) {
    hint.available = false;
    hint.refreshing = true;
    void answerSearchAvailable(projectId, deploymentId);
  }
  return hint.available;
};

const indexedChunkPayloadSchema = z.object({
  project_id: z.string(),
  deployment_id: z.string(),
  version_slug: z.string(),
  language: z.string(),
  visibility: z.enum(['public', 'private']),
  visible: z.literal(true),
  page_id: z.string(),
  ordinal: z.number().int().nonnegative(),
  title: z.string(),
  path: z.string(),
  description: z.string().default(''),
  heading: z.string().default(''),
  heading_path: z.array(z.string()).default([]),
  // Recorded since section anchors; points indexed before have none. A value
  // that is not a usable id is ignored rather than dropping the whole point.
  anchor: z.string().optional().catch(undefined),
  content: z.string(),
  content_hash: z.string(),
  direction: z.enum(['ltr', 'rtl']),
  icon: z.string().optional(),
});

export const answerSearchAvailable = async (projectId?: string, deploymentId?: string): Promise<boolean> => {
  let available = false;
  try {
    available = await readAnswerAvailability(projectId, deploymentId);
  } catch (error) {
    // The site shell and keyword search must keep working; only the AI
    // capability is reported unavailable.
    log.warn({ projectId, errorName: error instanceof Error ? error.name : 'UnknownError' }, 'AI answer readiness check failed');
  }
  // Shell/answer readiness checks also warm the keyword response's hint.
  // Actual answer requests always read live state; only the UI hint is cached.
  if (projectId && deploymentId) keywordAnswerHints.set(JSON.stringify([projectId, deploymentId]), { available, at: Date.now(), refreshing: false });
  return available;
};

const readAnswerAvailability = async (projectId?: string, deploymentId?: string) => {
  if (!qdrant || !(await configuredIndexServing())) return false;
  if (!projectId) return Boolean(env.OPENROUTER_API_KEY && env.SEARCH_ANSWER_ENABLED);
  const runtime = await resolveWorkspaceAi(projectId);
  if (!runtime?.answersEnabled) return false;
  if (!deploymentId) return true;
  return indexRunServesAnswers(await findCurrentIndexRun(projectId, deploymentId, { status: true, indexedChunks: true }));
};

export const filterForSearchScope = (scope: SearchScope): QdrantFilter | null => {
  if (scope.allowedPageIds !== null && scope.allowedPageIds.size === 0) return null;
  return {
    must: [
      { key: 'project_id', match: { value: scope.projectId } },
      { key: 'deployment_id', match: { value: scope.deploymentId } },
      { key: 'version_slug', match: { value: scope.versionSlug } },
      { key: 'language', match: { value: scope.language } },
      { key: 'visibility', match: { value: scope.visibility } },
      { key: 'visible', match: { value: true } },
      ...(scope.allowedPageIds === null ? [] : [{ key: 'page_id', match: { any: [...scope.allowedPageIds].sort() } }]),
    ],
  };
};

/** Treat Qdrant payload as untrusted. Recheck every server-derived scope field
 * after retrieval so stale/misindexed points cannot cross an authorization boundary. */
export const chunkFromPoint = (point: QdrantScoredPoint, scope: SearchScope): HybridChunkHit | null => {
  const parsed = indexedChunkPayloadSchema.safeParse(point.payload);
  if (!parsed.success) return null;
  const payload = parsed.data;
  if (
    payload.project_id !== scope.projectId ||
    payload.deployment_id !== scope.deploymentId ||
    payload.version_slug !== scope.versionSlug ||
    payload.language !== scope.language ||
    payload.visibility !== scope.visibility
  ) {
    return null;
  }
  if (!payload.page_id || (scope.allowedPageIds !== null && !scope.allowedPageIds.has(payload.page_id))) return null;
  const id = String(point.id);
  if (!payload.title || !payload.content || !payload.content_hash) return null;
  const chunk: SearchChunk = {
    id,
    pageId: payload.page_id,
    ordinal: payload.ordinal,
    title: payload.title,
    path: payload.path,
    description: payload.description,
    heading: payload.heading,
    headingPath: payload.heading_path,
    ...(payload.anchor ? { anchor: payload.anchor } : {}),
    content: payload.content,
    contentHash: payload.content_hash,
    language: scope.language,
    direction: payload.direction,
    visible: true,
    icon: payload.icon,
  };
  return { chunk, score: Number.isFinite(point.score) ? point.score : 0 };
};

interface RetrievalResult {
  cacheHit: boolean;
  chunks: HybridChunkHit[];
  confidence: number;
}

interface QuestionEmbedding {
  query: string;
  vector: () => Promise<number[]>;
}

const retrieveHybrid = async (
  scope: SearchScope,
  query: string,
  limit: number,
  signal?: AbortSignal,
  runtime?: WorkspaceAiRuntime,
  embedding?: QuestionEmbedding,
): Promise<RetrievalResult> => {
  const filter = filterForSearchScope(scope);
  if (!filter || !query.trim()) return { cacheHit: false, chunks: [], confidence: 0 };
  const client = qdrant;
  const resolved = runtime ?? (await resolveWorkspaceAi(scope.projectId));
  const provider = resolved ? workspaceEmbeddingProvider(resolved) : null;
  if (!client || !provider) throw new Error('Hybrid search is not configured.');
  if (client.vectorSize !== provider.dimensions) throw new Error('Qdrant vector size and embedding dimensions must match.');
  const key = searchCacheKey(
    scope,
    query,
    `chunks-v5-${resolved?.revision}-${env.QDRANT_COLLECTION_VERSION}-${provider.model}-${env.SEARCH_DENSE_MIN_SCORE}-${limit}-${embedding?.query ?? query}`,
  );
  const cached = retrievalCache.get(key);
  if (cached) return { cacheHit: true, chunks: cached, confidence: retrievalConfidence(cached) };
  const dense = embedding ? await embedding.vector() : ((await provider.embed([query], signal)).vectors[0] ?? []);
  signal?.throwIfAborted();
  const points = await client.queryHybrid(
    {
      dense,
      sparse: sparseVectorForQuery(query, scope.language),
      filter,
      // Security takes precedence over a broader statistical population: an
      // unauthorized page cannot influence a reader's BM25 score through IDF.
      idfCorpus: filter,
      // Rerank the candidate pool before cutting to the reader's limit. Dense
      // near-misses must not evict strong title matches before reranking runs.
      limit: Math.max(limit, env.SEARCH_CANDIDATE_LIMIT),
      candidateLimit: env.SEARCH_CANDIDATE_LIMIT,
      denseScoreThreshold: env.SEARCH_DENSE_MIN_SCORE,
    },
    signal,
  );
  signal?.throwIfAborted();
  const chunks = rerankHybridChunks(
    query,
    points.flatMap((point) => {
      const hit = chunkFromPoint(point, scope);
      return hit ? [hit] : [];
    }),
  ).slice(0, limit);
  retrievalCache.set(key, chunks);
  return { cacheHit: false, chunks, confidence: retrievalConfidence(chunks) };
};

export interface SearchRuntimeResult {
  hits: SearchHit[];
  runtime: 'legacy' | 'legacy-fallback' | 'shadow' | 'hybrid';
}

// Readiness, workspace lookup, embedding and retrieval share this budget. The
// keyword lane does not depend on any of them, including on a cold instance.
const READER_HYBRID_BUDGET_MS = 80;

export const runPublishedSearch = async (
  scope: SearchScope,
  query: string,
  limit: number,
  legacy: () => Promise<SearchHit[]>,
  signal?: AbortSignal,
): Promise<SearchRuntimeResult> => {
  if (env.SEARCH_RUNTIME === 'legacy') return { hits: await legacy(), runtime: 'legacy' };
  if (env.SEARCH_RUNTIME === 'shadow') {
    const legacyHits = await legacy();
    // Even alias/provider readiness belongs to the comparison, not to the
    // reader's keyword response. A slow Qdrant cannot hold shadow search open.
    void (async () => {
      if (!qdrant || !(await configuredIndexServing())) return;
      const provider = await resolveWorkspaceAi(scope.projectId);
      if (!provider) return;
      const result = await retrieveHybrid(scope, query, Math.max(limit * 4, 24), signal, provider);
      const hybridIds = new Set(collapseChunkHits(result.chunks, limit, query).map((hit) => hit.id));
      const overlap = legacyHits.filter((hit) => hybridIds.has(hit.id)).length;
      log.info(
        {
          projectId: scope.projectId,
          deploymentId: scope.deploymentId,
          language: scope.language,
          legacyCount: legacyHits.length,
          hybridCount: hybridIds.size,
          overlap,
        },
        'hybrid search shadow comparison',
      );
    })().catch(() => log.warn({ projectId: scope.projectId }, 'hybrid search shadow request failed'));
    return { hits: legacyHits, runtime: 'shadow' };
  }
  signal?.throwIfAborted();
  const controller = new AbortController();
  const hybridSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const deadline = performance.now() + READER_HYBRID_BUDGET_MS;
  const expired = () => hybridSignal.aborted || performance.now() >= deadline;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    hybridSignal.addEventListener('abort', () => resolve(null), { once: true });
    timer = setTimeout(() => controller.abort(), READER_HYBRID_BUDGET_MS);
  });
  const keyword = Promise.resolve().then(legacy);
  const hybrid = (async () => {
    // Check after each uncancellable lookup so a late readiness/configuration
    // response cannot start an embedding request after the reader has moved on.
    if (!qdrant || !(await configuredIndexServing()) || expired()) return null;
    const provider = await resolveWorkspaceAi(scope.projectId);
    if (!provider || expired()) return null;
    const result = await retrieveHybrid(scope, query, Math.max(limit * 4, 24), hybridSignal, provider);
    if (expired() || result.chunks.length === 0) return null;
    const language = oramaLanguageForCode(scope.language);
    const terms = readerSearchTerms(query, language);
    const scored = result.chunks.map((hit) => ({
      ...hit,
      score: readerRelevanceScore(
        terms,
        readerSearchFields({ ...hit.chunk, headings: [...hit.chunk.headingPath, hit.chunk.heading].join(' ') }, language),
      ),
    }));
    const floor = readerRelevanceFloor(Math.max(0, ...scored.map((hit) => hit.score)));
    const hits = collapseChunkHits(
      scored.filter((hit) => hit.score >= floor),
      limit,
      query,
    );
    return expired() ? null : hits;
  })().catch(() => {
    if (!hybridSignal.aborted) log.error({ projectId: scope.projectId }, 'hybrid search failed; using rollback runtime');
    return null;
  });
  try {
    const [keywordHits, hybridHits] = await Promise.all([keyword, Promise.race([hybrid, timeout])]);
    signal?.throwIfAborted();
    return hybridHits === null ? { hits: keywordHits, runtime: 'legacy-fallback' } : { hits: hybridHits, runtime: 'hybrid' };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
};

/** Score bonus for chunks from the page the reader asked about. Small enough
 * that a clearly better match elsewhere in the docs still wins. */
const PAGE_CONTEXT_BOOST = 0.12;
/** The reader explicitly asked about this page, so its own chunks are relevant
 * even when the question ("summarize this") embeds poorly on its own. */
const PAGE_CONTEXT_MIN_CONFIDENCE = 0.5;

export interface ChatRetrieval {
  chunks: SearchChunk[];
  hits: HybridChunkHit[];
  confidence: number;
  /** Main-query confidence before the reader's current page receives a boost. */
  searchConfidence?: number;
  /** The main retrieval lane was served from the in-process cache. */
  cacheHit: boolean;
}

/** A page with this few sections among the results likely matched on one passage
 * while its other sections fell under the dense threshold (a different wording,
 * often in Arabic). */
const THIN_PAGE_SECTIONS = 2;
/** At most this many thin pages are read in full, the best-scored first. */
const WIDENED_PAGES = 2;
/** Thin pages are chosen among the pages of the best-ranked results. */
const WIDEN_FROM_TOP = 8;
/** The sections an answer reads (`selectAnswerChunks`' default). */
const ANSWER_SECTIONS = 12;
/** The best main results keep their places in the answer, and each widened page
 * has at most its share of the others, so a weaker thin page with many sections
 * cannot crowd out a stronger one or the results the question matched. */
const KEPT_RESULTS = 6;
const WIDENED_SECTIONS = (ANSWER_SECTIONS - KEPT_RESULTS) / WIDENED_PAGES;
/** Thin pages among the best-ranked results, the best-scored first: the answer
 * also reads their other sections. Each is a page the reader may read, since it
 * came from their own results; `best` is its best main-search score. */
export const pagesToWiden = (hits: HybridChunkHit[]): { id: string; title: string; best: number }[] => {
  const pages = new Map<string, { title: string; sections: Set<string>; best: number }>();
  for (const { chunk, score } of hits) {
    const page = pages.get(chunk.pageId) ?? { title: chunk.title, sections: new Set<string>(), best: score };
    page.sections.add(chunk.id);
    page.best = Math.max(page.best, score);
    pages.set(chunk.pageId, page);
  }
  const top = new Set(hits.slice(0, WIDEN_FROM_TOP).map((hit) => hit.chunk.pageId));
  return [...pages]
    .filter(([id, page]) => top.has(id) && page.sections.size <= THIN_PAGE_SECTIONS)
    .sort(([, left], [, right]) => right.best - left.best)
    .slice(0, WIDENED_PAGES)
    .map(([id, page]) => ({ id, title: page.title, best: page.best }));
};

/** The sections an answer reads when pages were widened, in ranking order: the
 * best main results, then each widened page's best sections up to its share,
 * then the rest by score. */
const widenedAnswerSections = (hits: HybridChunkHit[], main: HybridChunkHit[], pages: string[]): HybridChunkHit[] => {
  const chosen = new Set(main.slice(0, KEPT_RESULTS).map((hit) => hit.chunk.id));
  for (const pageId of pages) {
    const share = hits.filter((hit) => hit.chunk.pageId === pageId && !chosen.has(hit.chunk.id)).slice(0, WIDENED_SECTIONS);
    for (const hit of share) chosen.add(hit.chunk.id);
  }
  for (const hit of hits) if (chosen.size < ANSWER_SECTIONS) chosen.add(hit.chunk.id);
  return hits.filter((hit) => chosen.has(hit.chunk.id));
};

type HybridSearch = (
  scope: SearchScope,
  query: string,
  limit: number,
  signal?: AbortSignal,
  runtime?: WorkspaceAiRuntime,
  embedding?: QuestionEmbedding,
) => Promise<RetrievalResult>;

export interface ChatLanguageContext {
  /** Enabled languages from the server-resolved publication, never the body. */
  languages: string[];
  defaultLanguage?: string;
  /** Version pages already restricted to the reader's grants. */
  pages: Pick<SnapshotPage, 'id' | 'title' | 'path' | 'translationKey' | 'languageCode' | 'kind' | 'hidden'>[];
}

const CHAT_RETRIEVAL_LIMITS = { fallbackLanguages: 2, translations: 2, concurrency: 2, calls: 8, deadlineMs: 8000 };
const emptyRetrieval = (): RetrievalResult => ({ chunks: [], confidence: 0, cacheHit: false });

/** Bound even a provider that ignores cancellation; its pending promise still
 * has rejection handlers, and cooperative providers receive the same signal. */
const untilAborted = <T>(work: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });

/** Search the question's language before trying other published languages.
 * Every lane retains the same tenant, deployment, version and page grants. */
export const retrieveChatLanguages = async (
  scope: SearchScope,
  query: string,
  runtime: WorkspaceAiRuntime,
  context: ChatLanguageContext,
  options: { language: string; page?: { id: string; title: string }; signal?: AbortSignal },
  search: HybridSearch = retrieveHybrid,
): Promise<ChatRetrieval> => {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException('Retrieval deadline exceeded', 'TimeoutError')), CHAT_RETRIEVAL_LIMITS.deadlineMs);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  let vector: Promise<number[]> | undefined;
  const embedding: QuestionEmbedding = {
    query,
    vector: () => {
      vector ??= workspaceEmbeddingProvider(runtime)
        .embed([query], signal)
        .then((result) => result.vectors[0] ?? []);
      return vector;
    },
  };
  let calls = 0;
  const active = new Set<Promise<RetrievalResult>>();
  const boundedSearch: HybridSearch = async (target, text, limit) => {
    while (active.size >= CHAT_RETRIEVAL_LIMITS.concurrency) await Promise.race(active);
    options.signal?.throwIfAborted();
    if (signal.aborted || calls >= CHAT_RETRIEVAL_LIMITS.calls) return emptyRetrieval();
    calls++;
    const work = untilAborted(search(target, text, limit, signal, runtime, embedding), signal).catch((error: unknown) => {
      options.signal?.throwIfAborted();
      if (deadline.signal.aborted) return emptyRetrieval();
      throw error;
    });
    active.add(work);
    try {
      return await work;
    } finally {
      active.delete(work);
    }
  };
  try {
    const preferred =
      context.languages.find((language) => language === options.language) ??
      context.languages.find((language) => language.split('-')[0] === options.language.split('-')[0]);
    const primaryLanguage =
      preferred ??
      context.languages.find((language) => language === scope.language) ??
      context.languages.find((language) => language === context.defaultLanguage) ??
      context.languages[0];
    if (!primaryLanguage) return { chunks: [], hits: [], confidence: 0, cacheHit: false };
    const primaryScope = { ...scope, language: primaryLanguage };
    const readable = context.pages.filter(
      (page) => page.kind === 'PAGE' && !page.hidden && (scope.allowedPageIds === null || scope.allowedPageIds.has(page.id)),
    );
    const currentPage = readable.find((page) => page.id === options.page?.id);
    const translatedPage = currentPage && readable.find((page) => page.languageCode === primaryLanguage && isPageTranslation(currentPage, page));
    const primary = await retrieveChatContext(
      primaryScope,
      query,
      runtime,
      {
        signal,
        page: translatedPage ? { id: translatedPage.id, title: translatedPage.title } : undefined,
      },
      boundedSearch,
    );
    if (primary.chunks.length && (primary.searchConfidence ?? primary.confidence) >= env.SEARCH_ANSWER_MIN_CONFIDENCE) return primary;

    const counts = new Map<string, number>();
    for (const page of readable) counts.set(page.languageCode, (counts.get(page.languageCode) ?? 0) + 1);
    const fallbackLanguages = [...new Set(context.languages)]
      .filter((language) => language !== primaryLanguage)
      .sort(
        (left, right) =>
          Number(right === context.defaultLanguage) - Number(left === context.defaultLanguage) ||
          (counts.get(right) ?? 0) - (counts.get(left) ?? 0) ||
          left.localeCompare(right),
      )
      .slice(0, CHAT_RETRIEVAL_LIMITS.fallbackLanguages);
    const fallbacks = await Promise.all(
      fallbackLanguages.map((language) => retrieveChatContext({ ...scope, language }, query, runtime, { signal, widen: false }, boundedSearch)),
    );
    const best =
      [primary, ...fallbacks].sort((left, right) => (right.searchConfidence ?? right.confidence) - (left.searchConfidence ?? left.confidence))[0] ??
      primary;
    if (best === primary || best.confidence < env.SEARCH_ANSWER_MIN_CONFIDENCE) return best;

    // A cross-language hit may identify a translated guide that the original
    // wording missed. Read that actual translation, rather than relabeling a hit.
    const translations = new Map<string, { id: string; title: string }>();
    for (const { chunk } of best.hits.slice(0, WIDEN_FROM_TOP)) {
      const source = readable.find((page) => page.id === chunk.pageId);
      const translated = source && readable.find((page) => page.languageCode === preferred && isPageTranslation(source, page));
      if (translated) translations.set(source.id, { id: translated.id, title: translated.title });
      if (translations.size >= CHAT_RETRIEVAL_LIMITS.translations) break;
    }
    const translatedHits = new Map<string, HybridChunkHit[]>();
    for (const [sourceId, page] of translations) {
      const lane = await boundedSearch({ ...primaryScope, allowedPageIds: new Set([page.id]) }, `${page.title} ${query}`, 6);
      if (lane.chunks.length) translatedHits.set(sourceId, lane.chunks);
    }
    const hits = best.hits.flatMap((hit) => translatedHits.get(hit.chunk.pageId) ?? [hit]);
    return { ...best, hits, chunks: selectAnswerChunks(hits), cacheHit: false };
  } finally {
    clearTimeout(timer);
    deadline.abort();
  }
};

/** Retrieval for one chat turn. The optional page lane narrows the same
 * server-derived scope to a single page — it can never widen the reader's
 * grants: a page outside `allowedPageIds` is simply not searched. Without page
 * context, thin pages among the best results are read the same way, ranked no
 * higher than their own best result: they add context, never reorder it. */
export const retrieveChatContext = async (
  scope: SearchScope,
  query: string,
  runtime: WorkspaceAiRuntime,
  options: { page?: { id: string; title: string }; signal?: AbortSignal; widen?: boolean } = {},
  search: HybridSearch = retrieveHybrid,
): Promise<ChatRetrieval> => {
  const page = options.page && (scope.allowedPageIds === null || scope.allowedPageIds.has(options.page.id)) ? options.page : undefined;
  const pageSearch = (target: { id: string; title: string }) =>
    search({ ...scope, allowedPageIds: new Set([target.id]) }, `${target.title} ${query}`, 6, options.signal, runtime);
  const [main, asked] = await Promise.all([search(scope, query, 12, options.signal, runtime), page ? pageSearch(page) : Promise.resolve(null)]);
  // A turn the main search is not confident about is refused: it reads nothing more.
  const widen = options.widen === false || page || main.confidence < env.SEARCH_ANSWER_MIN_CONFIDENCE ? [] : pagesToWiden(main.chunks);
  const widened = await Promise.all(widen.map(async (target) => ({ target, lane: await pageSearch(target) })));
  if (!asked?.chunks.length && !widened.some(({ lane }) => lane.chunks.length)) {
    return {
      chunks: selectAnswerChunks(main.chunks),
      hits: main.chunks,
      confidence: main.confidence,
      searchConfidence: main.confidence,
      cacheHit: main.cacheHit,
    };
  }
  const merged = new Map<string, HybridChunkHit>();
  const add = (hit: HybridChunkHit) => {
    const current = merged.get(hit.chunk.id);
    if (!current || hit.score > current.score) merged.set(hit.chunk.id, hit);
  };
  for (const hit of main.chunks) add(hit);
  // The page the reader asked about is relevant by their choice.
  for (const hit of asked?.chunks ?? []) add({ ...hit, score: hit.score + PAGE_CONTEXT_BOOST });
  // A widened page's other sections sit just under its own best result, in the
  // page lane's order: their scores come from a query with the page title added,
  // so they are not comparable with the main search.
  for (const { target, lane } of widened)
    for (const [index, hit] of lane.chunks.entries()) add({ ...hit, score: Math.min(hit.score, target.best) - (index + 1) * 1e-6 });
  const hits = [...merged.values()].sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id));
  const read = widen.length
    ? widenedAnswerSections(
        hits,
        main.chunks,
        widen.map((target) => target.id),
      )
    : hits;
  return {
    chunks: selectAnswerChunks(read, ANSWER_SECTIONS),
    hits,
    // Asked from the page, its passages are relevant by the reader's choice; a
    // widened page keeps the confidence of the search that found it.
    confidence: page ? Math.max(retrievalConfidence(hits), PAGE_CONTEXT_MIN_CONFIDENCE) : main.confidence,
    searchConfidence: main.confidence,
    cacheHit: main.cacheHit,
  };
};

/** The live provider runtime for a chat turn, or null when answers are off. */
export const resolveChatRuntime = async (projectId: string): Promise<WorkspaceAiRuntime | null> => {
  if (!qdrant || !(await configuredIndexServing())) return null;
  const runtime = await resolveWorkspaceAi(projectId);
  return runtime?.answersEnabled ? runtime : null;
};

export const answerPublishedSearch = async (
  scope: SearchScope,
  query: string,
  signal?: AbortSignal,
  /** `sections` resolves each source to a section of its published page (see
   * `publishedSections`); sources it leaves out are never given to the model. */
  context?: ChatLanguageContext & { sections?: SectionResolver },
): Promise<GroundedAnswer & { cacheHit: boolean }> => {
  const runtime = await resolveWorkspaceAi(scope.projectId);
  if (!qdrant || !runtime?.answersEnabled || !(await configuredIndexServing())) throw new Error('AI answers are not configured.');
  const cacheKey = searchCacheKey(
    scope,
    query,
    `answer-v5-${runtime.revision}-${env.QDRANT_COLLECTION_VERSION}-${runtime.embeddingModel}-${runtime.answerModel}-${context?.languages.join(',')}`,
  );
  const cached = answerCache.get(cacheKey);
  if (cached) return { ...cached, cacheHit: true };
  const language = questionLanguage(query, scope.language, context?.languages);
  const retrieval = context
    ? await retrieveChatLanguages(scope, query, runtime, context, { language, signal })
    : await retrieveChatContext(scope, query, runtime, { signal });
  const provider = workspaceAnswerProvider(runtime);
  const sections = context?.sections;
  const answer = await generateGroundedAnswer(
    provider,
    query,
    sections ? retrieval.chunks.flatMap((chunk) => sections(chunk) ?? []) : retrieval.chunks,
    retrieval.confidence,
    language,
    signal,
    env.SEARCH_ANSWER_MIN_CONFIDENCE,
  );
  answerCache.set(cacheKey, answer);
  return { ...answer, cacheHit: false };
};
