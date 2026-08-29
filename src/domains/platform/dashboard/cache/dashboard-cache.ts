import { Injectable } from "@nestjs/common";
import { RedisCacheService } from "../../../../core/cache/redis-cache.service";

/**
 * Dashboard read cache.
 *
 * Backed by Redis so entries survive redeploys and are shared across backend
 * instances — previously every replica warmed its own copy and every deploy
 * threw it away. When Redis is unavailable it transparently falls back to a
 * per-process map, so the dashboard works with or without it.
 */
@Injectable()
export class DashboardCache {
  private readonly local = new Map<
    string,
    { data: unknown; expiresAt: number }
  >();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly store: RedisCacheService) {}

  private key(key: string): string {
    return `dashboard:${key}`;
  }

  async getOrFetch<T>(
    key: string,
    ttlMs: number,
    fetch: () => Promise<T>
  ): Promise<T> {
    if (this.store.isEnabled()) {
      const { value } = await this.store.through(this.key(key), ttlMs, fetch);
      return value;
    }
    return this.localGetOrFetch(key, ttlMs, fetch);
  }

  async invalidate(key: string): Promise<void> {
    this.local.delete(key);
    await this.store.invalidate(this.key(key));
  }

  /** Local-only; used by tests and by the fallback path. */
  clear(): void {
    this.local.clear();
    this.inflight.clear();
  }

  size(): number {
    return this.local.size;
  }

  private async localGetOrFetch<T>(
    key: string,
    ttlMs: number,
    fetch: () => Promise<T>
  ): Promise<T> {
    const entry = this.local.get(key);
    if (entry && entry.expiresAt > Date.now()) return entry.data as T;
    if (entry) this.local.delete(key);

    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = (async () => {
      try {
        const data = await fetch();
        this.local.set(key, { data, expiresAt: Date.now() + ttlMs });
        return data;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    return promise;
  }
}
