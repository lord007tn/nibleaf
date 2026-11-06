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
  if (!qdrant) return false;
  if (!projectId) return Boolean(env.OPENROUTER_API_KEY && env.SEARCH_ANSWER_ENABLED);
  const runtime = await resolveWorkspaceAi(projectId);
  if (!runtime?.answersEnabled) return false;
  if (!deploymentId) return true;
  const latestRun = await prisma.searchIndexRun.findFirst({
    where: { projectId, deploymentId },
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
  if (!qdrant) return { hits: await legacy(), runtime: 'legacy-fallback' };
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
/** The best-ranked pages, at most this many, that are read in full when thin. */
const WIDENED_PAGES = 2;
/** The best-ranked pages that appear only thinly among the results: the answer
 * also reads their other sections, as it would for a reader asking from the
 * page. Each is a page the reader may read, since it came from their own results. */
export const pagesToWiden = (hits: HybridChunkHit[]): { id: string; title: string }[] => {
  const sections = new Map<string, { title: string; chunks: Set<string> }>();
  for (const { chunk } of hits) {
    const page = sections.get(chunk.pageId) ?? { title: chunk.title, chunks: new Set<string>() };
    page.chunks.add(chunk.id);
    sections.set(chunk.pageId, page);
  }
  // Map order is the order pages first appear in the ranked hits.
  return [...sections]
    .slice(0, WIDENED_PAGES)
    .filter(([, page]) => page.chunks.size <= THIN_PAGE_SECTIONS)
    .map(([id, page]) => ({ id, title: page.title }));
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
 * context, the best-ranked pages that appear only thinly are read the same way. */
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
  const lanes = asked ? [asked] : await Promise.all(pagesToWiden(main.chunks).map(pageSearch));
  if (!lanes.some((lane) => lane.chunks.length > 0)) {
    return { chunks: selectAnswerChunks(main.chunks), hits: main.chunks, confidence: main.confidence, cacheHit: main.cacheHit };
  }
  const merged = new Map<string, HybridChunkHit>();
  for (const hit of main.chunks) merged.set(hit.chunk.id, hit);
  for (const lane of lanes)
    for (const hit of lane.chunks) {
      const boosted = { ...hit, score: hit.score + PAGE_CONTEXT_BOOST };
      const current = merged.get(hit.chunk.id);
      if (!current || boosted.score > current.score) merged.set(hit.chunk.id, boosted);
    }
  const hits = [...merged.values()].sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id));
  return {
    chunks: selectAnswerChunks(hits),
    hits,
    // Asked from the page, its passages are relevant by the reader's choice; a
    // widened page keeps the confidence of the search that found it.
    confidence: page ? Math.max(retrievalConfidence(hits), PAGE_CONTEXT_MIN_CONFIDENCE) : main.confidence,
    cacheHit: main.cacheHit,
  };
};

/** The live provider runtime for a chat turn, or null when answers are off. */
export const resolveChatRuntime = async (projectId: string): Promise<WorkspaceAiRuntime | null> => {
  if (!qdrant) return null;
  const runtime = await resolveWorkspaceAi(projectId);
  return runtime?.answersEnabled ? runtime : null;
};

export const answerPublishedSearch = async (
  scope: SearchScope,
  query: string,
  signal?: AbortSignal,
): Promise<GroundedAnswer & { cacheHit: boolean }> => {
  const runtime = await resolveWorkspaceAi(scope.projectId);
  if (!qdrant || !runtime?.answersEnabled) throw new Error('AI answers are not configured.');
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
