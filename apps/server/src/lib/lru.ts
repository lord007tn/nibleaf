/**
 * Minimal in-process LRU built on Map insertion order: `get` refreshes recency,
 * `set` evicts the least-recently-used entry once `max` is exceeded. No TTL —
 * pair with your own staleness check when entries can go stale (see TtlCache).
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly max: number) {}

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined;
    }
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next();
      if (oldest.done) {
        break;
      }
      this.map.delete(oldest.value);
    }
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  clear(): void {
    this.map.clear();
  }
}

/** LRU whose entries also expire after `ttlMs` — for data that must re-read
 *  from the source within a bounded delay (e.g. live project config). */
export class TtlCache<K, V> {
  private readonly lru: LruCache<K, { value: V; at: number }>;

  constructor(
    max: number,
    private readonly ttlMs: number,
  ) {
    this.lru = new LruCache(max);
  }

  get(key: K): V | undefined {
    const entry = this.lru.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() - entry.at > this.ttlMs) {
      this.lru.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.lru.set(key, { value, at: Date.now() });
  }

  delete(key: K): boolean {
    return this.lru.delete(key);
  }
}
