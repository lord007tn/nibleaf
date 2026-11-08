/**
 * Minimal in-process LRU built on Map insertion order: `get` refreshes recency,
 * `set` evicts the least-recently-used entry once `max` weight is exceeded. No TTL —
 * pair with your own staleness check when entries can go stale (see TtlCache).
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, { value: V; weight: number }>();
  private weight = 0;

  constructor(
    private readonly max: number,
    private readonly weightOf: (value: V) => number = () => 1,
    private readonly onEvict?: (key: K, value: V) => void,
  ) {}

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined;
    }
    const entry = this.map.get(key) as { value: V; weight: number };
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  canAdmit(weight: number): boolean {
    return Number.isFinite(weight) && weight >= 0 && Math.max(1, weight) <= this.max;
  }

  set(key: K, value: V): boolean {
    const weight = Math.max(1, this.weightOf(value));
    // Reject before touching existing entries, including an older value for this key.
    if (!this.canAdmit(weight)) return false;
    this.delete(key);
    this.map.set(key, { value, weight });
    this.weight += weight;
    while (this.weight > this.max) {
      const oldest = this.map.keys().next();
      if (oldest.done) {
        break;
      }
      const evicted = this.map.get(oldest.value);
      this.delete(oldest.value);
      if (evicted) this.onEvict?.(oldest.value, evicted.value);
    }
    return true;
  }

  delete(key: K): boolean {
    const entry = this.map.get(key);
    if (entry) this.weight -= entry.weight;
    return this.map.delete(key);
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  clear(): void {
    this.map.clear();
    this.weight = 0;
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
