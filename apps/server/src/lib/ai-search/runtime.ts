import { prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { getQdrantClient, type QdrantFilter, type QdrantScoredPoint } from '@nibleaf/qdrant';
import {
  collapseChunkHits,
  type GroundedAnswer,
  generateGroundedAnswer,
  type HybridChunkHit,
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
import { z } from 'zod';
import { env } from '@/env';
import { TtlCache } from '@/lib/lru';

const log = createLogger({ component: 'ai-search' });
const retrievalCache = new TtlCache<string, HybridChunkHit[]>(500, env.SEARCH_CACHE_TTL_MS);
const answerCache = new TtlCache<string, GroundedAnswer>(250, env.SEARCH_CACHE_TTL_MS);
const qdrant = getQdrantClient();

/** How long one reading of the alias's target is trusted. */
const INDEX_CHECK_MS = 30_000;
/** A failed reading is retried sooner, so a brief Qdrant outage pauses AI answers only briefly. */
const INDEX_RETRY_MS = 5000;
let indexCheck: { at: number; ttl: number; serving: Promise<boolean> } | undefined;
let lastServed: string | null | undefined;

/** Whether the read alias serves the collection this instance is configured
 * for (its alias, collection version and vector size). After an embedding
 * change the new collection is filled while the alias still serves the old
 * one; querying it with the new vectors would fail. Until the operator
 * reindexes and switches the alias, search keeps its keyword results and AI
 * answers pause instead. A failed reading also counts as not serving. */
const configuredIndexServing = async (): Promise<boolean> => {
  const client = qdrant;
  if (!client) return false;
  const now = Date.now();
  if (!indexCheck || now - indexCheck.at >= indexCheck.ttl) {
    const check: NonNullable<typeof indexCheck> = { at: now, ttl: INDEX_CHECK_MS, serving: Promise.resolve(false) };
    check.serving = client.servedCollection().then(
      (served) => {
        if (served !== lastServed) {
          lastServed = served;
          const context = { alias: client.alias, served, configured: client.collection };
          if (served === client.collection) log.info(context, 'Hybrid search is serving the configured collection');
          else if (served === null) log.info(context, 'No hybrid search collection yet; the first index job creates it');
          else
            log.error(
              context,
              'Hybrid search and AI answers are paused: the search alias serves a collection built for other embedding settings. Reindex every site, then switch the alias to the configured collection (docs: self-hosting/search-ai, "Change the embedding model").',
            );
        }
        return served === client.collection;
      },
      (error: unknown) => {
        // Fail closed (keyword results, no AI answers), and read again soon.
        check.ttl = INDEX_RETRY_MS;
        log.warn(
          { alias: client.alias, configured: client.collection, error: error instanceof Error ? error.message : 'unknown error' },
          'Could not read the search alias; hybrid search and AI answers are paused until the next check',
        );
        return false;
      },
    );
    indexCheck = check;
  }
  return indexCheck.serving;
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
  content: z.string(),
  content_hash: z.string(),
  direction: z.enum(['ltr', 'rtl']),
  icon: z.string().optional(),
});

export const answerSearchAvailable = async (projectId?: string, deploymentId?: string): Promise<boolean> => {
  try {
    return await readAnswerAvailability(projectId, deploymentId);
  } catch (error) {
    // The site shell and keyword search must keep working; only the AI
    // capability is reported unavailable.
    log.warn({ projectId, errorName: error instanceof Error ? error.name : 'UnknownError' }, 'AI answer readiness check failed');
    return false;
  }
};

const readAnswerAvailability = async (projectId?: string, deploymentId?: string) => {
  if (!qdrant || !(await configuredIndexServing())) return false;
  if (!projectId) return Boolean(env.OPENROUTER_API_KEY && env.SEARCH_ANSWER_ENABLED);
  const runtime = await resolveWorkspaceAi(projectId);
  if (!runtime?.answersEnabled) return false;
  if (!deploymentId) return true;
  // Only runs built with the current embedding settings indexed the collection
  // being served; a newer run for other settings (before a rollback) does not count.
  const latestRun = await prisma.searchIndexRun.findFirst({
    where: {
      projectId,
      deploymentId,
      schemaVersion: env.QDRANT_COLLECTION_VERSION,
      embeddingModel: env.SEARCH_EMBEDDING_MODEL,
      vectorSize: env.SEARCH_EMBEDDING_DIMENSIONS,
    },
    orderBy: { createdAt: 'desc' },
    select: { status: true, indexedChunks: true },
  });
  return latestRun?.status === 'READY' && latestRun.indexedChunks > 0;
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

const retrieveHybrid = async (
  scope: SearchScope,
  query: string,
  limit: number,
  signal?: AbortSignal,
  runtime?: WorkspaceAiRuntime,
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
    `chunks-v3-${resolved?.revision}-${env.QDRANT_COLLECTION_VERSION}-${provider.model}-${env.SEARCH_DENSE_MIN_SCORE}-${limit}`,
  );
  const cached = retrievalCache.get(key);
  if (cached) return { cacheHit: true, chunks: cached, confidence: retrievalConfidence(cached) };
  const embedded = await provider.embed([query], signal);
  const points = await client.queryHybrid(
    {
      dense: embedded.vectors[0] ?? [],
      sparse: sparseVectorForQuery(query, scope.language),
      filter,
      // Security takes precedence over a broader statistical population: an
      // unauthorized page cannot influence a reader's BM25 score through IDF.
      idfCorpus: filter,
      limit,
      candidateLimit: env.SEARCH_CANDIDATE_LIMIT,
      denseScoreThreshold: env.SEARCH_DENSE_MIN_SCORE,
    },
    signal,
  );
  const chunks = rerankHybridChunks(
    query,
    points.flatMap((point) => {
      const hit = chunkFromPoint(point, scope);
      return hit ? [hit] : [];
    }),
  );
  retrievalCache.set(key, chunks);
  return { cacheHit: false, chunks, confidence: retrievalConfidence(chunks) };
};

export interface SearchRuntimeResult {
  hits: SearchHit[];
  runtime: 'legacy' | 'legacy-fallback' | 'shadow' | 'hybrid';
}

export const runPublishedSearch = async (
  scope: SearchScope,
  query: string,
  limit: number,
  legacy: () => Promise<SearchHit[]>,
  signal?: AbortSignal,
): Promise<SearchRuntimeResult> => {
  if (env.SEARCH_RUNTIME === 'legacy') return { hits: await legacy(), runtime: 'legacy' };
  // Keyword results, without paying to embed a query the serving index cannot answer.
  if (!qdrant || !(await configuredIndexServing())) return { hits: await legacy(), runtime: 'legacy-fallback' };
  const provider = await resolveWorkspaceAi(scope.projectId).catch(() => null);
  if (!provider) return { hits: await legacy(), runtime: 'legacy-fallback' };
  if (env.SEARCH_RUNTIME === 'shadow') {
    const legacyHits = await legacy();
    void retrieveHybrid(scope, query, Math.max(limit * 4, 24), signal, provider)
      .then((result) => {
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
      })
      .catch(() => log.warn({ projectId: scope.projectId }, 'hybrid search shadow request failed'));
    return { hits: legacyHits, runtime: 'shadow' };
  }
  try {
    const result = await retrieveHybrid(scope, query, Math.max(limit * 4, 24), signal, provider);
    // A newly published deployment can be served before its async index job
    // finishes. Keep ordinary search working during that window and recovery.
    if (result.chunks.length === 0) return { hits: await legacy(), runtime: 'legacy-fallback' };
    return { hits: collapseChunkHits(result.chunks, limit, query), runtime: 'hybrid' };
  } catch {
    log.error({ projectId: scope.projectId }, 'hybrid search failed; using rollback runtime');
    return { hits: await legacy(), runtime: 'legacy-fallback' };
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
) => Promise<RetrievalResult>;

/** Retrieval for one chat turn. The optional page lane narrows the same
 * server-derived scope to a single page — it can never widen the reader's
 * grants: a page outside `allowedPageIds` is simply not searched. Without page
 * context, thin pages among the best results are read the same way, ranked no
 * higher than their own best result: they add context, never reorder it. */
export const retrieveChatContext = async (
  scope: SearchScope,
  query: string,
  runtime: WorkspaceAiRuntime,
  options: { page?: { id: string; title: string }; signal?: AbortSignal } = {},
  search: HybridSearch = retrieveHybrid,
): Promise<ChatRetrieval> => {
  const page = options.page && (scope.allowedPageIds === null || scope.allowedPageIds.has(options.page.id)) ? options.page : undefined;
  const pageSearch = (target: { id: string; title: string }) =>
    search({ ...scope, allowedPageIds: new Set([target.id]) }, `${target.title} ${query}`, 6, options.signal, runtime);
  const [main, asked] = await Promise.all([search(scope, query, 12, options.signal, runtime), page ? pageSearch(page) : Promise.resolve(null)]);
  // A turn the main search is not confident about is refused: it reads nothing more.
  const widen = page || main.confidence < env.SEARCH_ANSWER_MIN_CONFIDENCE ? [] : pagesToWiden(main.chunks);
  const widened = await Promise.all(widen.map(async (target) => ({ target, lane: await pageSearch(target) })));
  if (!asked?.chunks.length && !widened.some(({ lane }) => lane.chunks.length)) {
    return { chunks: selectAnswerChunks(main.chunks), hits: main.chunks, confidence: main.confidence, cacheHit: main.cacheHit };
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
): Promise<GroundedAnswer & { cacheHit: boolean }> => {
  const runtime = await resolveWorkspaceAi(scope.projectId);
  if (!qdrant || !runtime?.answersEnabled || !(await configuredIndexServing())) throw new Error('AI answers are not configured.');
  const cacheKey = searchCacheKey(
    scope,
    query,
    `answer-v3-${runtime.revision}-${env.QDRANT_COLLECTION_VERSION}-${runtime.embeddingModel}-${runtime.answerModel}`,
  );
  const cached = answerCache.get(cacheKey);
  if (cached) return { ...cached, cacheHit: true };
  const retrieval = await retrieveHybrid(scope, query, 12, signal, runtime);
  const provider = workspaceAnswerProvider(runtime);
  const answer = await generateGroundedAnswer(
    provider,
    query,
    selectAnswerChunks(retrieval.chunks),
    retrieval.confidence,
    scope.language,
    signal,
    env.SEARCH_ANSWER_MIN_CONFIDENCE,
  );
  answerCache.set(cacheKey, answer);
  return { ...answer, cacheHit: false };
};
