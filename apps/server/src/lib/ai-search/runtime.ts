import { createLogger } from '@nibleaf/logger';
import { getQdrantClient, type QdrantFilter, type QdrantScoredPoint } from '@nibleaf/qdrant';
import {
  collapseChunkHits,
  type GroundedAnswer,
  generateGroundedAnswer,
  type HybridChunkHit,
  OpenAICompatibleChatProvider,
  OpenAICompatibleEmbeddingProvider,
  rerankHybridChunks,
  retrievalConfidence,
  type SearchChunk,
  type SearchHit,
  type SearchScope,
  searchCacheKey,
  sparseVectorForQuery,
} from '@nibleaf/search';
import { env } from '@/env';
import { TtlCache } from '@/lib/lru';

const log = createLogger({ component: 'ai-search' });
const retrievalCache = new TtlCache<string, HybridChunkHit[]>(500, env.SEARCH_CACHE_TTL_MS);
const answerCache = new TtlCache<string, GroundedAnswer>(250, env.SEARCH_CACHE_TTL_MS);
const qdrant = getQdrantClient();

const embeddingApiKey = (): string | undefined => env.SEARCH_EMBEDDING_API_KEY ?? env.OPENAI_API_KEY;

const embeddings = () => {
  const apiKey = embeddingApiKey();
  if (!apiKey) return null;
  return new OpenAICompatibleEmbeddingProvider({
    apiKey,
    baseUrl: env.SEARCH_EMBEDDING_BASE_URL,
    model: env.SEARCH_EMBEDDING_MODEL,
    dimensions: env.SEARCH_EMBEDDING_DIMENSIONS,
    timeoutMs: env.SEARCH_EMBEDDING_TIMEOUT_MS,
  });
};

export const hybridSearchAvailable = (): boolean => Boolean(qdrant && embeddingApiKey());
export const answerSearchAvailable = (): boolean => hybridSearchAvailable() && env.SEARCH_ANSWER_ENABLED && Boolean(env.SEARCH_ANSWER_API_KEY);

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

const stringPayload = (payload: Record<string, unknown>, key: string): string | null =>
  typeof payload[key] === 'string' ? (payload[key] as string) : null;

/** Treat Qdrant payload as untrusted. Recheck every server-derived scope field
 * after retrieval so stale/misindexed points cannot cross an authorization boundary. */
export const chunkFromPoint = (point: QdrantScoredPoint, scope: SearchScope): HybridChunkHit | null => {
  const payload = point.payload;
  if (!payload) return null;
  if (
    stringPayload(payload, 'project_id') !== scope.projectId ||
    stringPayload(payload, 'deployment_id') !== scope.deploymentId ||
    stringPayload(payload, 'version_slug') !== scope.versionSlug ||
    stringPayload(payload, 'language') !== scope.language ||
    stringPayload(payload, 'visibility') !== scope.visibility ||
    payload.visible !== true
  ) {
    return null;
  }
  const pageId = stringPayload(payload, 'page_id');
  if (!pageId || (scope.allowedPageIds !== null && !scope.allowedPageIds.has(pageId))) return null;
  const id = String(point.id);
  const title = stringPayload(payload, 'title');
  const path = stringPayload(payload, 'path');
  const content = stringPayload(payload, 'content');
  const contentHash = stringPayload(payload, 'content_hash');
  if (!title || path === null || !content || !contentHash) return null;
  const direction = payload.direction === 'rtl' ? 'rtl' : 'ltr';
  const headingPath = Array.isArray(payload.heading_path) ? payload.heading_path.filter((item): item is string => typeof item === 'string') : [];
  const chunk: SearchChunk = {
    id,
    pageId,
    ordinal: typeof payload.ordinal === 'number' ? payload.ordinal : 0,
    title,
    path,
    description: stringPayload(payload, 'description') ?? '',
    heading: stringPayload(payload, 'heading') ?? '',
    headingPath,
    content,
    contentHash,
    language: scope.language,
    direction,
    visible: true,
    icon: stringPayload(payload, 'icon') ?? undefined,
  };
  return { chunk, score: Number.isFinite(point.score) ? point.score : 0 };
};

export interface RetrievalResult {
  cacheHit: boolean;
  chunks: HybridChunkHit[];
  confidence: number;
}

export const retrieveHybrid = async (scope: SearchScope, query: string, limit: number, signal?: AbortSignal): Promise<RetrievalResult> => {
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
  if (!answerSearchAvailable() || !env.SEARCH_ANSWER_API_KEY) throw new Error('AI answers are not configured.');
  const cacheKey = searchCacheKey(
    scope,
    query,
    `answer-v1-${env.QDRANT_COLLECTION_VERSION}-${env.SEARCH_EMBEDDING_MODEL}-${env.SEARCH_ANSWER_MODEL}`,
  );
  const cached = answerCache.get(cacheKey);
  if (cached) return { ...cached, cacheHit: true };
  const retrieval = await retrieveHybrid(scope, query, 12, signal);
  const provider = new OpenAICompatibleChatProvider({
    apiKey: env.SEARCH_ANSWER_API_KEY,
    baseUrl: env.SEARCH_ANSWER_BASE_URL,
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
