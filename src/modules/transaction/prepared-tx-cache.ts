import { Injectable } from "@nestjs/common";

export interface PreparedTxEntry {
  hash: string;
  passphrase: string;
  sourceAccount: string;
  expiresAt: number;
}

interface InternalEntry extends PreparedTxEntry {
  /** Monotonic insertion id used for LRU-style eviction. */
  seq: number;
}

const DEFAULT_TTL_MS = 120_000;
const DEFAULT_MAX_SIZE = 10_000;

/**
 * PreparedTxCache (D2, D17)
 *
 * In-memory Map keyed by sourceAccount. Each entry holds the hash of a prepared
 * transaction, the network passphrase at prepare-time, and a TTL. `consume()`
 * is one-shot — submit deletes the entry once validated.
 *
 * Eviction policy: TTL-based (lazy on read) plus a hard maxSize cap that evicts
 * the oldest insertion first.
 */
@Injectable()
export class PreparedTxCache {
  private readonly store = new Map<string, InternalEntry>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private seqCounter = 0;

  constructor(opts: { ttlMs?: number; maxSize?: number } = {}) {
    this.maxSize = opts.maxSize ?? DEFAULT_MAX_SIZE;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  }

  set(
    sourceAccount: string,
    entry: Omit<PreparedTxEntry, "sourceAccount" | "expiresAt"> & {
      expiresAt?: number;
    }
  ): PreparedTxEntry {
    const now = Date.now();
    const full: InternalEntry = {
      hash: entry.hash,
      passphrase: entry.passphrase,
      sourceAccount,
      expiresAt: entry.expiresAt ?? now + this.ttlMs,
      seq: ++this.seqCounter,
    };
    this.store.set(sourceAccount, full);
    this.evictIfNeeded();
    return full;
  }

  /**
   * Look up and remove a prepared-tx entry by sourceAccount. Returns undefined
   * if missing or expired (expired entries are deleted in passing).
   */
  consume(sourceAccount: string): PreparedTxEntry | undefined {
    const entry = this.store.get(sourceAccount);
    if (!entry) return undefined;
    this.store.delete(sourceAccount);
    if (entry.expiresAt <= Date.now()) return undefined;
    return entry;
  }

  /** Non-destructive read — used only in tests / introspection. */
  peek(sourceAccount: string): PreparedTxEntry | undefined {
    const entry = this.store.get(sourceAccount);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(sourceAccount);
      return undefined;
    }
    return entry;
  }

  size(): number {
    return this.store.size;
  }

  private evictIfNeeded() {
    if (this.store.size <= this.maxSize) return;

    // Sweep expired entries first.
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) this.store.delete(key);
    }
    if (this.store.size <= this.maxSize) return;

    // Still over capacity → drop oldest insertion(s).
    const overflow = this.store.size - this.maxSize;
    const sorted = Array.from(this.store.entries()).sort(
      (a, b) => a[1].seq - b[1].seq
    );
    for (let i = 0; i < overflow; i++) {
      this.store.delete(sorted[i][0]);
    }
  }
}
