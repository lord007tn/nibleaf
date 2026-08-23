import { keys } from './keys';

export type QdrantScalar = string | number | boolean;

export interface QdrantMatchCondition {
  key: string;
  match: { any?: QdrantScalar[]; value?: QdrantScalar };
}

export interface QdrantFilter {
  must: QdrantMatchCondition[];
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
  /** The broader tenant population used for BM25 IDF statistics. */
  idfCorpus: QdrantFilter;
  limit: number;
  candidateLimit?: number;
}

export interface QdrantScoredPoint {
  id: string | number;
  payload?: Record<string, unknown> | null;
  score: number;
}

interface QdrantEnvelope<T> {
  result: T;
  status?: string;
  time?: number;
}

interface QdrantCollectionList {
  collections: Array<{ name: string }>;
}

export interface QdrantClientOptions {
  alias?: string;
  apiKey?: string;
  fetch?: typeof fetch;
  schemaVersion?: string;
  timeoutMs?: number;
  url: string;
  vectorSize?: number;
}

const withoutTrailingSlash = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
};
const encode = (value: string): string => encodeURIComponent(value);
const requiredRetrievalFields = ['project_id', 'deployment_id', 'version_slug', 'language', 'visibility', 'visible'] as const;

const hasFilterField = (filter: QdrantFilter, key: string): boolean => filter.must.some((condition) => condition.key === key);

const assertTenantFilter = (filter: QdrantFilter): void => {
  const project = filter.must.find((condition) => condition.key === 'project_id')?.match.value;
  if (typeof project !== 'string' || project.length === 0) throw new TypeError('Qdrant operation requires an explicit project_id filter.');
};

const stableFilter = (filter: QdrantFilter): string => JSON.stringify(filter);

const qdrantError = (status: number, body: string): Error => {
  const safeBody = body.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
  return new Error(`Qdrant request failed (${status})${safeBody ? `: ${safeBody}` : ''}`);
};

/** Minimal REST client for the Qdrant features Nibleaf owns. Keeping this
 * wrapper small makes every mandatory tenant filter visible and testable. */
export class QdrantClient {
  readonly alias: string;
  readonly collection: string;
  readonly vectorSize: number;
  private readonly apiKey?: string;
  private readonly requestFetch: typeof fetch;
  private readonly timeoutMs: number;
  private readonly url: string;

  constructor(options: QdrantClientOptions) {
    this.url = withoutTrailingSlash(options.url);
    this.apiKey = options.apiKey;
    this.alias = options.alias ?? 'nibleaf_search_active';
    this.vectorSize = options.vectorSize ?? 1536;
    this.collection = `${this.alias}_${options.schemaVersion ?? 'v1'}_${this.vectorSize}`;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.requestFetch = options.fetch ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const response = await this.requestFetch(`${this.url}${path}`, {
      ...init,
      signal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(this.apiKey ? { 'api-key': this.apiKey } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) throw qdrantError(response.status, await response.text());
    if (response.status === 204) return undefined as T;
    const envelope = (await response.json()) as QdrantEnvelope<T>;
    return envelope.result;
  }

  health(): Promise<{ title?: string; version?: string }> {
    return this.request('/');
  }

  private async collectionExists(name: string): Promise<boolean> {
    try {
      await this.request(`/collections/${encode(name)}`);
      return true;
    } catch (error) {
      return error instanceof Error && error.message.includes('(404)') ? false : Promise.reject(error);
    }
  }

  private async createPayloadIndex(fieldName: string, fieldSchema: string | Record<string, unknown>): Promise<void> {
    await this.request(`/collections/${encode(this.collection)}/index?wait=true`, {
      method: 'PUT',
      body: JSON.stringify({ field_name: fieldName, field_schema: fieldSchema }),
    });
  }

  /** Create the versioned collection and its mandatory filter indexes before
   * data upload. The alias is created only when absent; schema cutovers must use
   * switchAlias explicitly so startup can never perform an accidental migration. */
  async ensureHybridCollection(): Promise<{ alias: string; collection: string; created: boolean }> {
    const exists = await this.collectionExists(this.collection);
    if (!exists) {
      await this.request(`/collections/${encode(this.collection)}`, {
        method: 'PUT',
        body: JSON.stringify({
          vectors: { dense: { size: this.vectorSize, distance: 'Cosine' } },
          sparse_vectors: { bm25: { modifier: 'idf' } },
          hnsw_config: { m: 0, payload_m: 16 },
          strict_mode_config: { enabled: true, unindexed_filtering_retrieve: false, unindexed_filtering_update: false },
        }),
      });
      await this.createPayloadIndex('project_id', { type: 'keyword', is_tenant: true });
      await this.createPayloadIndex('deployment_id', 'keyword');
      await this.createPayloadIndex('version_slug', 'keyword');
      await this.createPayloadIndex('language', 'keyword');
      await this.createPayloadIndex('visibility', 'keyword');
      await this.createPayloadIndex('page_id', 'keyword');
      await this.createPayloadIndex('visible', 'bool');
      await this.createPayloadIndex('content_hash', 'keyword');
    }

    let aliasExists = true;
    try {
      await this.request(`/aliases/${encode(this.alias)}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('(404)')) aliasExists = false;
      else throw error;
    }
    if (!aliasExists) {
      await this.request('/collections/aliases', {
        method: 'POST',
        body: JSON.stringify({ actions: [{ create_alias: { collection_name: this.collection, alias_name: this.alias } }] }),
      });
    }
    return { alias: this.alias, collection: this.collection, created: !exists };
  }

  async switchAlias(previousCollection?: string): Promise<void> {
    const actions = [
      ...(previousCollection ? [{ delete_alias: { collection_name: previousCollection, alias_name: this.alias } }] : []),
      { create_alias: { collection_name: this.collection, alias_name: this.alias } },
    ];
    await this.request('/collections/aliases', { method: 'POST', body: JSON.stringify({ actions }) });
  }

  async upsert(points: QdrantPoint[], signal?: AbortSignal): Promise<void> {
    if (points.length === 0) return;
    for (const point of points) {
      if (point.vector.dense.length !== this.vectorSize) throw new TypeError('Qdrant point dense vector has the wrong dimension.');
      for (const field of [...requiredRetrievalFields, 'page_id', 'content_hash']) {
        if (point.payload[field] === undefined || point.payload[field] === null) throw new TypeError(`Qdrant point is missing ${field}.`);
      }
    }
    // Index the versioned physical collection, never the read alias. This lets
    // operators build and validate a replacement before an explicit cutover.
    await this.request(`/collections/${encode(this.collection)}/points?wait=true`, {
      method: 'PUT',
      body: JSON.stringify({ points }),
      signal,
    });
  }

  private async deleteFromCollection(collection: string, filter: QdrantFilter, signal?: AbortSignal): Promise<void> {
    await this.request(`/collections/${encode(collection)}/points/delete?wait=true`, {
      method: 'POST',
      body: JSON.stringify({ filter }),
      signal,
    });
  }

  async deleteByFilter(filter: QdrantFilter, signal?: AbortSignal): Promise<void> {
    assertTenantFilter(filter);
    await this.deleteFromCollection(this.alias, filter, signal);
  }

  /** Erasure must include retained rollback collections, not only the active
   * alias. A strict alias prefix keeps the sweep inside Nibleaf-owned search
   * collections while the project filter remains mandatory on every delete. */
  async deleteByFilterAllVersions(filter: QdrantFilter, signal?: AbortSignal): Promise<number> {
    assertTenantFilter(filter);
    const result = await this.request<QdrantCollectionList>('/collections', { signal });
    const collections = result.collections.map(({ name }) => name).filter((name) => name.startsWith(`${this.alias}_`));
    await Promise.all(collections.map((collection) => this.deleteFromCollection(collection, filter, signal)));
    return collections.length;
  }

  async count(filter: QdrantFilter, signal?: AbortSignal): Promise<number> {
    assertTenantFilter(filter);
    const result = await this.request<{ count: number }>(`/collections/${encode(this.alias)}/points/count`, {
      method: 'POST',
      body: JSON.stringify({ filter, exact: true }),
      signal,
    });
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
    const candidateLimit = Math.max(input.limit, input.candidateLimit ?? input.limit * 4);
    const result = await this.request<{ points: QdrantScoredPoint[] }>(`/collections/${encode(this.alias)}/points/query`, {
      method: 'POST',
      body: JSON.stringify({
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
      }),
      signal,
    });
    return result.points;
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
