import { createLogger } from '@nibleaf/logger';
import { getQdrantClient, type QdrantFilter, type QdrantScoredPoint } from '@nibleaf/qdrant';
import {
  collapseChunkHits,
  type GroundedAnswer,
  generateGroundedAnswer,
  type HybridChunkHit,
  OpenRouterChatProvider,
  OpenRouterEmbeddingProvider,
  rerankHybridChunks,
  retrievalConfidence,
  type SearchChunk,
  type SearchHit,
  type SearchScope,
  searchCacheKey,
  sparseVectorForQuery,
} from '@nibleaf/search';
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

const embeddings = () => {
  if (!env.OPENROUTER_API_KEY) return null;
  return new OpenRouterEmbeddingProvider({
    apiKey: env.OPENROUTER_API_KEY,
    model: env.SEARCH_EMBEDDING_MODEL,
    dimensions: env.SEARCH_EMBEDDING_DIMENSIONS,
    timeoutMs: env.SEARCH_EMBEDDING_TIMEOUT_MS,
    siteUrl: env.APP_URL,
    title: env.APP_NAME,
  });
};

const hybridSearchAvailable = () => Boolean(qdrant && env.OPENROUTER_API_KEY);
export const answerSearchAvailable = () => hybridSearchAvailable() && env.SEARCH_ANSWER_ENABLED;

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

const retrieveHybrid = async (scope: SearchScope, query: string, limit: number, signal?: AbortSignal): Promise<RetrievalResult> => {
  const filter = filterForSearchScope(scope);
  if (!filter || !query.trim()) return { cacheHit: false, chunks: [], confidence: 0 };
  const client = qdrant;
  const provider = embeddings();
  if (!client || !provider) throw new Error('Hybrid search is not configured.');
  if (client.vectorSize !== provider.dimensions) throw new Error('Qdrant vector size and embedding dimensions must match.');
  const key = searchCacheKey(scope, query, `chunks-v1-${env.QDRANT_COLLECTION_VERSION}-${env.SEARCH_EMBEDDING_MODEL}-${limit}`);
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
  if (!hybridSearchAvailable()) return { hits: await legacy(), runtime: 'legacy-fallback' };
  if (env.SEARCH_RUNTIME === 'shadow') {
    const legacyHits = await legacy();
    void retrieveHybrid(scope, query, Math.max(limit * 4, 24), signal)
      .then((result) => {
        const hybridIds = new Set(collapseChunkHits(result.chunks, limit).map((hit) => hit.id));
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
      .catch((error) => log.warn({ projectId: scope.projectId, error }, 'hybrid search shadow request failed'));
    return { hits: legacyHits, runtime: 'shadow' };
  }
  try {
    const result = await retrieveHybrid(scope, query, Math.max(limit * 4, 24), signal);
    return { hits: collapseChunkHits(result.chunks, limit), runtime: 'hybrid' };
  } catch (error) {
    log.error({ projectId: scope.projectId, error }, 'hybrid search failed; using rollback runtime');
    return { hits: await legacy(), runtime: 'legacy-fallback' };
  }
};

export const answerPublishedSearch = async (
  scope: SearchScope,
  query: string,
  signal?: AbortSignal,
): Promise<GroundedAnswer & { cacheHit: boolean }> => {
  if (!answerSearchAvailable() || !env.OPENROUTER_API_KEY) throw new Error('AI answers are not configured.');
  const cacheKey = searchCacheKey(
    scope,
    query,
    `answer-v1-${env.QDRANT_COLLECTION_VERSION}-${env.SEARCH_EMBEDDING_MODEL}-${env.SEARCH_ANSWER_MODEL}`,
  );
  const cached = answerCache.get(cacheKey);
  if (cached) return { ...cached, cacheHit: true };
  const retrieval = await retrieveHybrid(scope, query, 12, signal);
  const provider = new OpenRouterChatProvider({
    apiKey: env.OPENROUTER_API_KEY,
    model: env.SEARCH_ANSWER_MODEL,
    timeoutMs: env.SEARCH_ANSWER_TIMEOUT_MS,
    temperature: 0,
    siteUrl: env.APP_URL,
    title: 'Nibleaf grounded documentation answers',
  });
  const answer = await generateGroundedAnswer(
    provider,
    query,
    retrieval.chunks.slice(0, 8).map((hit) => hit.chunk),
    retrieval.confidence,
    scope.language,
    signal,
    env.SEARCH_ANSWER_MIN_CONFIDENCE,
  );
  answerCache.set(cacheKey, answer);
  return { ...answer, cacheHit: false };
};
