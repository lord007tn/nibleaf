import { QdrantClient as QdrantSdkClient } from '@qdrant/js-client-rest';
import { z } from 'zod';
import { keys } from './keys';

export type QdrantScalar = string | number | boolean;

export interface QdrantMatchCondition {
  key: string;
  match: { any?: Array<string | number>; value?: QdrantScalar };
}

export interface QdrantHasIdCondition {
  has_id: Array<string | number>;
}

export interface QdrantFilter {
  must: Array<QdrantMatchCondition | QdrantHasIdCondition>;
  must_not?: QdrantMatchCondition[];
}

export interface SparseVector {
  indices: number[];
  values: number[];
}

export interface QdrantPoint {
  id: string;
  payload: Record<string, unknown>;
  vector: { dense: number[]; bm25: SparseVector };
}

export interface HybridQueryInput {
  dense: number[];
  sparse: SparseVector;
  filter: QdrantFilter;
  /** The authorized population used for BM25 IDF statistics. */
  idfCorpus: QdrantFilter;
  limit: number;
  candidateLimit?: number;
}

export interface QdrantScoredPoint {
  id: string | number;
  payload?: Record<string, unknown> | null;
  score: number;
}

export interface QdrantIndexedPoint {
  id: string | number;
  payload: Record<string, unknown>;
  vector?: { dense: number[]; bm25: SparseVector };
}

export interface QdrantClientOptions {
  alias?: string;
  apiKey?: string;
  client?: QdrantSdkClient;
  schemaVersion?: string;
  timeoutMs?: number;
  url: string;
  vectorSize?: number;
}

const requiredRetrievalFields = ['project_id', 'deployment_id', 'version_slug', 'language', 'visibility', 'visible'] as const;
const pointPayloadSchema = z.record(z.string(), z.unknown());
const namedVectorSchema = z.object({
  dense: z.array(z.number()),
  bm25: z.object({ indices: z.array(z.number()), values: z.array(z.number()) }),
});

const matchCondition = (condition: QdrantMatchCondition | QdrantHasIdCondition): condition is QdrantMatchCondition => 'key' in condition;

const projectIdFromFilter = (filter: QdrantFilter) => {
  for (const condition of filter.must) {
    if (matchCondition(condition) && condition.key === 'project_id') return condition.match.value;
  }
  return undefined;
};

const assertTenantFilter = (filter: QdrantFilter): void => {
  const parsed = z.string().min(1).safeParse(projectIdFromFilter(filter));
  if (!parsed.success) throw new TypeError('Qdrant operation requires an explicit project_id filter.');
};

const hasFilterField = (filter: QdrantFilter, key: string): boolean =>
  filter.must.some((condition) => matchCondition(condition) && condition.key === key);
const withPointIds = (filter: QdrantFilter, ids: Array<string | number>): QdrantFilter => ({ must: [...filter.must, { has_id: ids }] });
const stableFilter = (filter: QdrantFilter): string => JSON.stringify(filter);
const ensureNotAborted = (signal?: AbortSignal): void => signal?.throwIfAborted();

/**
 * Tenant-safe wrapper over Qdrant's official JavaScript SDK. Domain callers
 * cannot choose a collection name and every read/delete path validates an
 * explicit project filter before the SDK performs I/O.
 */
export class QdrantClient {
  readonly alias: string;
  readonly collection: string;
  readonly vectorSize: number;
  private readonly sdk: QdrantSdkClient;

  constructor(options: QdrantClientOptions) {
    this.alias = options.alias ?? 'nibleaf_search_active';
    this.vectorSize = options.vectorSize ?? 1536;
    this.collection = `${this.alias}_${options.schemaVersion ?? 'v1'}_${this.vectorSize}`;
    this.sdk =
      options.client ??
      new QdrantSdkClient({
        url: options.url,
        apiKey: options.apiKey,
        timeout: options.timeoutMs ?? 8_000,
      });
  }

  health() {
    return this.sdk.versionInfo();
  }

  /** Remove this client's exact versioned physical collection. Intended for
   * failed migration rollback and integration-test cleanup, never tenant data. */
  async dropVersionedCollection(): Promise<void> {
    await this.sdk.deleteCollection(this.collection);
  }

  /** Create the versioned physical collection and its filter indexes. Alias
   * movement stays explicit so startup cannot silently perform a migration. */
  async ensureHybridCollection() {
    const collectionState = await this.sdk.collectionExists(this.collection);
    if (!collectionState.exists) {
      await this.sdk.createCollection(this.collection, {
        vectors: { dense: { size: this.vectorSize, distance: 'Cosine' } },
        sparse_vectors: { bm25: { modifier: 'idf' } },
        hnsw_config: { m: 0, payload_m: 16 },
        strict_mode_config: { enabled: true, unindexed_filtering_retrieve: false, unindexed_filtering_update: false },
      });
      await this.sdk.createPayloadIndex(this.collection, {
        wait: true,
        field_name: 'project_id',
        field_schema: { type: 'keyword', is_tenant: true },
      });
      await this.sdk.createPayloadIndex(this.collection, { wait: true, field_name: 'deployment_id', field_schema: 'keyword' });
      await this.sdk.createPayloadIndex(this.collection, { wait: true, field_name: 'version_slug', field_schema: 'keyword' });
      await this.sdk.createPayloadIndex(this.collection, { wait: true, field_name: 'language', field_schema: 'keyword' });
      await this.sdk.createPayloadIndex(this.collection, { wait: true, field_name: 'visibility', field_schema: 'keyword' });
      await this.sdk.createPayloadIndex(this.collection, { wait: true, field_name: 'page_id', field_schema: 'keyword' });
      await this.sdk.createPayloadIndex(this.collection, { wait: true, field_name: 'visible', field_schema: 'bool' });
      await this.sdk.createPayloadIndex(this.collection, { wait: true, field_name: 'content_hash', field_schema: 'keyword' });
    }

    const aliases = await this.sdk.getAliases();
    const aliasExists = aliases.aliases.some((item) => item.alias_name === this.alias);
    if (!aliasExists) {
      await this.sdk.updateCollectionAliases({ actions: [{ create_alias: { collection_name: this.collection, alias_name: this.alias } }] });
    }
    return { alias: this.alias, collection: this.collection, created: !collectionState.exists };
  }

  async switchAlias(previousCollection?: string): Promise<void> {
    if (previousCollection) {
      await this.sdk.updateCollectionAliases({
        actions: [{ delete_alias: { alias_name: this.alias } }, { create_alias: { collection_name: this.collection, alias_name: this.alias } }],
      });
      return;
    }
    await this.sdk.updateCollectionAliases({ actions: [{ create_alias: { collection_name: this.collection, alias_name: this.alias } }] });
  }

  async upsert(points: QdrantPoint[], signal?: AbortSignal): Promise<void> {
    if (points.length === 0) return;
    ensureNotAborted(signal);
    for (const point of points) {
      if (point.vector.dense.length !== this.vectorSize) throw new TypeError('Qdrant point dense vector has the wrong dimension.');
      for (const field of [...requiredRetrievalFields, 'page_id', 'content_hash']) {
        if (point.payload[field] === undefined || point.payload[field] === null) throw new TypeError(`Qdrant point is missing ${field}.`);
      }
    }
    await this.sdk.upsert(this.collection, { wait: true, points });
    ensureNotAborted(signal);
  }

  private async deleteFromCollection(collection: string, filter: QdrantFilter, signal?: AbortSignal): Promise<void> {
    ensureNotAborted(signal);
    await this.sdk.delete(collection, { wait: true, filter });
    ensureNotAborted(signal);
  }

  async deleteByFilter(filter: QdrantFilter, signal?: AbortSignal): Promise<void> {
    assertTenantFilter(filter);
    await this.deleteFromCollection(this.alias, filter, signal);
  }

  /** Erasure includes retained rollback collections, never unrelated names. */
  async deleteByFilterAllVersions(filter: QdrantFilter, signal?: AbortSignal): Promise<number> {
    assertTenantFilter(filter);
    ensureNotAborted(signal);
    const result = await this.sdk.getCollections();
    const collections = result.collections.map(({ name }) => name).filter((name) => name.startsWith(`${this.alias}_`));
    await Promise.all(collections.map((collection) => this.deleteFromCollection(collection, filter, signal)));
    return collections.length;
  }

  async deletePoints(ids: Array<string | number>, filter: QdrantFilter, signal?: AbortSignal): Promise<void> {
    if (ids.length === 0) return;
    assertTenantFilter(filter);
    ensureNotAborted(signal);
    await this.sdk.delete(this.collection, { wait: true, filter: withPointIds(filter, ids) });
    ensureNotAborted(signal);
  }

  async replacePayload(id: string | number, payload: Record<string, unknown>, filter: QdrantFilter, signal?: AbortSignal): Promise<void> {
    assertTenantFilter(filter);
    ensureNotAborted(signal);
    await this.sdk.overwritePayload(this.collection, { wait: true, filter: withPointIds(filter, [id]), payload });
    ensureNotAborted(signal);
  }

  /** Read only payload identities for an indexing diff; vectors never leave
   * Qdrant and the mandatory project scope is checked on every page. */
  async listIndexedPoints(filter: QdrantFilter, includeVectors = false, signal?: AbortSignal): Promise<QdrantIndexedPoint[]> {
    assertTenantFilter(filter);
    const points: QdrantIndexedPoint[] = [];
    let offset: string | number | undefined;
    do {
      ensureNotAborted(signal);
      const page = await this.sdk.scroll(this.collection, {
        filter,
        limit: 256,
        offset,
        with_payload: true,
        with_vector: includeVectors,
      });
      for (const point of page.points) {
        const payload = pointPayloadSchema.safeParse(point.payload);
        const vector = namedVectorSchema.safeParse(point.vector);
        if (payload.success) points.push({ id: point.id, payload: payload.data, ...(vector.success ? { vector: vector.data } : {}) });
      }
      const nextOffset = z.union([z.string(), z.number()]).safeParse(page.next_page_offset);
      offset = nextOffset.success ? nextOffset.data : undefined;
    } while (offset !== undefined);
    ensureNotAborted(signal);
    return points;
  }

  async count(filter: QdrantFilter, signal?: AbortSignal): Promise<number> {
    assertTenantFilter(filter);
    ensureNotAborted(signal);
    const result = await this.sdk.count(this.alias, { filter, exact: true });
    ensureNotAborted(signal);
    return result.count;
  }

  async queryHybrid(input: HybridQueryInput, signal?: AbortSignal): Promise<QdrantScoredPoint[]> {
    assertTenantFilter(input.filter);
    for (const field of requiredRetrievalFields) {
      if (!hasFilterField(input.filter, field)) throw new TypeError(`Hybrid query requires an explicit ${field} filter.`);
    }
    if (stableFilter(input.idfCorpus) !== stableFilter(input.filter)) {
      throw new TypeError('Hybrid query IDF corpus must equal the authorized retrieval filter.');
    }
    if (input.dense.length !== this.vectorSize) throw new TypeError('Hybrid query dense vector has the wrong dimension.');
    ensureNotAborted(signal);
    const candidateLimit = Math.max(input.limit, input.candidateLimit ?? input.limit * 4);
    const result = await this.sdk.query(this.alias, {
      prefetch: [
        {
          query: input.sparse,
          using: 'bm25',
          filter: input.filter,
          params: { idf: { corpus: input.idfCorpus } },
          limit: candidateLimit,
        },
        { query: input.dense, using: 'dense', filter: input.filter, limit: candidateLimit },
      ],
      query: { rrf: {} },
      filter: input.filter,
      limit: input.limit,
      with_payload: true,
      with_vector: false,
    });
    ensureNotAborted(signal);
    return result.points.flatMap((point) => {
      const payload = pointPayloadSchema.nullable().safeParse(point.payload);
      return payload.success ? [{ id: point.id, payload: payload.data, score: point.score }] : [];
    });
  }
}

export const qdrantConfigured = (): boolean => Boolean(keys().QDRANT_URL);

export const getQdrantClient = (): QdrantClient | null => {
  const env = keys();
  if (!env.QDRANT_URL) return null;
  return new QdrantClient({
    url: env.QDRANT_URL,
    apiKey: env.QDRANT_API_KEY,
    alias: env.QDRANT_COLLECTION_ALIAS,
    schemaVersion: env.QDRANT_COLLECTION_VERSION,
    vectorSize: env.QDRANT_VECTOR_SIZE,
    timeoutMs: env.QDRANT_TIMEOUT_MS,
  });
};
