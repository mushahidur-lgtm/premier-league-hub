// @ts-check
/**
 * Small in-memory LRU cache with per-entry TTL and hit/miss diagnostics.
 *
 *   - Bounded: once `max` entries are held, the least recently *used* one is evicted.
 *   - Expiring: each entry carries its own TTL (chosen per data category by the caller).
 *   - Observable: stats() reports hits, misses, expirations, evictions, overall and per category.
 *
 * Values must not be `undefined` (that is how a miss is reported).
 */
export class LruCache {
  constructor({ max = 100, now = () => Date.now() } = {}) {
    this.max = max;
    this.now = now;
    this.map = new Map(); // insertion order = recency order (oldest first)
    this.counters = { hits: 0, misses: 0, expirations: 0, evictions: 0, sets: 0 };
    this.byCategory = {};
  }

  #cat(category) {
    return (this.byCategory[category ?? "default"] ??= { hits: 0, misses: 0, expirations: 0 });
  }

  get(key, category) {
    const c = this.#cat(category);
    const entry = this.map.get(key);
    if (!entry) {
      this.counters.misses++;
      c.misses++;
      return undefined;
    }
    if (this.now() >= entry.expiresAt) {
      this.map.delete(key);
      this.counters.expirations++;
      this.counters.misses++;
      c.expirations++;
      c.misses++;
      return undefined;
    }
    // Refresh recency: re-insert at the "newest" end.
    this.map.delete(key);
    this.map.set(key, entry);
    this.counters.hits++;
    c.hits++;
    return entry.value;
  }

  set(key, value, ttlMs) {
    if (value === undefined) return;
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + ttlMs });
    this.counters.sets++;
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
      this.counters.evictions++;
    }
  }

  delete(key) {
    return this.map.delete(key);
  }

  /** Removes every expired entry; returns how many went. */
  prune() {
    let n = 0;
    for (const [k, e] of this.map)
      if (this.now() >= e.expiresAt) {
        this.map.delete(k);
        n++;
      }
    this.counters.expirations += n;
    return n;
  }

  clear() {
    this.map.clear();
  }

  resetStats() {
    this.counters = { hits: 0, misses: 0, expirations: 0, evictions: 0, sets: 0 };
    this.byCategory = {};
  }

  keys() {
    return [...this.map.keys()];
  }

  get size() {
    return this.map.size;
  }

  stats() {
    const { hits, misses } = this.counters;
    return {
      size: this.map.size,
      max: this.max,
      ...this.counters,
      hitRate: hits + misses ? hits / (hits + misses) : null,
      byCategory: structuredClone(this.byCategory),
    };
  }
}
