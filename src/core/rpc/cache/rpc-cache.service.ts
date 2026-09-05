import { Injectable } from "@nestjs/common";
import { rpc, xdr } from "@stellar/stellar-sdk";
import { createHash } from "crypto";
import { RedisCacheService } from "../../cache/redis-cache.service";

/**
 * Why caching happens at the raw JSON-RPC layer rather than on the parsed
 * result:
 *
 * `rpc.Server` methods return objects containing XDR class instances — a
 * simulation's `result.retval` is an `xdr.ScVal`. Those do not survive a JSON
 * round-trip: after `JSON.parse(JSON.stringify(sim))` the retval is a plain
 * object and `scValToNative` throws `scv.switch is not a function`. Caching
 * the parsed object would silently corrupt every balance read.
 *
 * The SDK's public methods are `_rawMethod().then(parser)`, and it exposes
 * both halves. So the cache stores the raw wire response — which is plain JSON
 * by definition — and the parser runs on hit and miss alike, guaranteeing
 * identical shapes either way.
 */
export interface RawCachePlan {
  kind: "raw";
  /** Underscore-prefixed rpc.Server method returning the unparsed response. */
  rawMethod: string;
  parse: (raw: never) => unknown;
  ttlMs: number;
  /**
   * Decides from the response whether it may be stored, for methods where
   * only some answers are safe to keep.
   */
  cacheable?: (value: unknown) => boolean;
}

export interface PlainCachePlan {
  kind: "plain";
  ttlMs: number;
}

export interface NoCachePlan {
  kind: "none";
  reason: string;
}

export type CachePlan = RawCachePlan | PlainCachePlan | NoCachePlan;

/**
 * True only for a simulation that touched no state.
 *
 * `simulateTransaction` serves both roles: reading a balance and pricing a
 * deposit or withdrawal. They look identical at the JSON-RPC layer, but only
 * one is safe to keep. A write's simulation carries a footprint and a resource
 * fee measured against the ledger it ran on; replay that later and the
 * assembled transaction can underpay, which the network rejects with
 * txInsufficientFee.
 *
 * The response says which it is: a read leaves `readWrite` empty. Nothing has
 * to be inferred from contract or function names, so a new contract method is
 * classified correctly the day it ships.
 *
 * Anything unreadable is treated as uncacheable — declining to store a value
 * costs a round trip, storing the wrong one costs a failed transaction.
 */
export function isReadOnlySimulation(value: unknown): boolean {
  const data = (value as { transactionData?: unknown } | null)?.transactionData;
  if (typeof data !== "string" || data.length === 0) return false;
  try {
    return (
      xdr.SorobanTransactionData.fromXDR(data, "base64")
        .resources()
        .footprint()
        .readWrite().length === 0
    );
  } catch {
    return false;
  }
}

const RAW_PLANS: Record<string, RawCachePlan> = {
  // The hot path: every token and vault balance is read by simulating a
  // `balance()` call, so this is the method the cache exists for.
  simulateTransaction: {
    kind: "raw",
    rawMethod: "_simulateTransaction",
    parse: rpc.parseRawSimulation as (raw: never) => unknown,
    // Longer than it looks: a wallet's own transaction moves its sequence
    // number, which changes the envelope and drops its entries without any
    // invalidation. So this window only ever hides a balance that changed
    // without the wallet acting — someone sending it tokens — and the browser
    // already holds balances for 60s, twice as long.
    ttlMs: 30_000,
    cacheable: isReadOnlySimulation,
  },
  getEvents: {
    kind: "raw",
    rawMethod: "_getEvents",
    parse: rpc.parseRawEvents as (raw: never) => unknown,
    ttlMs: 10_000,
  },
};

/** Methods returning plain JSON, verified to round-trip losslessly. */
const PLAIN_PLANS: Record<string, PlainCachePlan> = {
  getLatestLedger: { kind: "plain", ttlMs: 2_000 },
  getNetwork: { kind: "plain", ttlMs: 3_600_000 },
  getVersionInfo: { kind: "plain", ttlMs: 3_600_000 },
  getFeeStats: { kind: "plain", ttlMs: 10_000 },
};

/**
 * Explicitly uncacheable, with the reason. Anything not listed anywhere is
 * uncached by default, so adding a new SDK method can never silently start
 * serving stale data.
 */
const NEVER_CACHE: Record<string, string> = {
  sendTransaction: "write path — must always reach the network",
  // Cached sequence numbers are a correctness bug, not a staleness trade-off:
  // building a transaction against a stale sequence produces txBadSeq.
  getAccount: "carries the sequence number used to build the next transaction",
  getAccountEntry: "same sequence-number hazard as getAccount",
  prepareTransaction: "wraps simulateTransaction and mutates the transaction",
  // The SDK does not export parseRawLedgerEntries / parseRawTransactions, so a
  // cached raw response cannot be re-hydrated without hand-rolling a parser
  // that would drift from the SDK. Deferred rather than risked.
  getLedgerEntries: "SDK parser not publicly exported",
  getLedgerEntry: "SDK parser not publicly exported",
  getTransaction: "SDK parser not publicly exported",
  getTransactions: "SDK parser not publicly exported",
  pollTransaction: "polls for freshness by definition",
  getHealth: "liveness signal — caching it defeats the purpose",
};

@Injectable()
export class RpcCacheService {
  constructor(private readonly store: RedisCacheService) {}

  isEnabled(): boolean {
    return this.store.isEnabled();
  }

  /** How, or whether, this method may be cached. */
  planFor(method: string): CachePlan {
    if (RAW_PLANS[method]) return RAW_PLANS[method];
    if (PLAIN_PLANS[method]) return PLAIN_PLANS[method];
    return {
      kind: "none",
      reason: NEVER_CACHE[method] ?? "not in the cacheable set",
    };
  }

  buildKey(method: string, args: unknown[]): string {
    const digest = createHash("sha256")
      .update(stableStringify(this.normalize(method, args)))
      .digest("hex");
    return `rpc:${method}:${digest}`;
  }

  /**
   * Strips a simulated transaction's validity window before it is hashed.
   *
   * `TransactionBuilder.setTimeout(n)` bakes `now + n` into the envelope, so
   * two identical balance reads a second apart serialised differently and
   * hashed to different keys. The entry could therefore never be reused: the
   * pool reported 0 hits against 373 misses, every one of them a
   * simulateTransaction, which is the method this cache exists for.
   *
   * Dropping the window is safe because a simulation's result does not depend
   * on when the transaction would be valid — it is never submitted. Source,
   * sequence, fee and operations all still key the entry, so two different
   * reads can never collide, and a wallet that transacts busts its own entries
   * for free because its sequence number moves.
   */
  private normalize(method: string, args: unknown[]): unknown[] {
    if (method !== "simulateTransaction") return args;
    const [params] = args;
    if (typeof params !== "object" || params === null) return args;
    const envelope = (params as { transaction?: unknown }).transaction;
    if (typeof envelope !== "string") return args;

    try {
      const parsed = xdr.TransactionEnvelope.fromXDR(envelope, "base64");
      if (parsed.switch().name !== "envelopeTypeTx") return args;
      parsed.v1().tx().cond(xdr.Preconditions.precondNone());
      return [{ ...params, transaction: parsed.toXDR("base64") }];
    } catch {
      // An envelope we cannot parse still deserves a key — just the old,
      // exact one. A cache must never turn a readable request into an error.
      return args;
    }
  }

  /**
   * Returns the cached value for `key`, or runs `exec` and stores its result.
   * Every Redis failure degrades to calling `exec` — the cache can never become
   * a source of errors.
   */
  async through<T>(
    key: string,
    ttlMs: number,
    exec: () => Promise<T>,
    cacheable?: (value: unknown) => boolean
  ): Promise<{ value: T; hit: boolean }> {
    return this.store.through(key, ttlMs, exec, cacheable);
  }

  /** Drops a single cached entry. Best effort. */
  async invalidate(method: string, args: unknown[]): Promise<void> {
    return this.store.invalidate(this.buildKey(method, args));
  }
}

/**
 * Object key order is not guaranteed across calls, so a naive stringify would
 * produce different cache keys for identical arguments. Sorting keys keeps the
 * digest stable. XDR-bearing arguments expose `toXDR()`, which is their
 * canonical string form.
 */
function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input !== "object") {
      return typeof input === "bigint" ? input.toString() : input;
    }
    if (seen.has(input)) return "[circular]";
    seen.add(input);

    const maybeXdr = input as { toXDR?: (fmt?: string) => unknown };
    if (typeof maybeXdr.toXDR === "function") {
      try {
        return String(maybeXdr.toXDR("base64"));
      } catch {
        // Fall through to structural normalization.
      }
    }

    if (Buffer.isBuffer(input)) return input.toString("base64");
    if (Array.isArray(input)) return input.map(normalize);

    return Object.keys(input as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalize((input as Record<string, unknown>)[key]);
        return acc;
      }, {});
  };

  return JSON.stringify(normalize(value)) ?? "";
}
