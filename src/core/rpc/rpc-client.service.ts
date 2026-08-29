import { Injectable, Logger } from "@nestjs/common";
import { RpcCacheService } from "./rpc-cache.service";
import { RpcMetricsService } from "./rpc-metrics.service";
import { PoolEndpoint, RpcPoolService } from "./rpc-pool.service";

/**
 * Pure reads. Safe to retry and to fail over across endpoints without limit —
 * they have no side effects on the network.
 */
const READ_METHODS = new Set([
  "getEvents",
  "getLatestLedger",
  "getLedgerEntries",
  "getNetwork",
  "getVersionInfo",
  "getHealth",
  "getFeeStats",
  "getContractData",
  "getAccount",
  "simulateTransaction",
  "getSACBalance",
  "getLedgers",
  "loadAccount",
]);

/**
 * Methods whose first argument is a transaction hash used to pin the request to
 * the endpoint that accepted the submission.
 */
const HASH_AFFINITY_METHODS = new Set(["getTransaction", "pollTransaction"]);

/** Max attempts across the whole pool for one logical call. */
export const MAX_ATTEMPTS = 4;
export const BASE_BACKOFF_MS = 120;
export const MAX_BACKOFF_MS = 2_000;
/**
 * How long a tx hash stays pinned to its submitting endpoint. Comfortably
 * longer than the ~30s it takes a transaction to reach a final status.
 */
export const AFFINITY_TTL_MS = 300_000;
const AFFINITY_MAX_ENTRIES = 10_000;

export class RpcPoolExhaustedError extends Error {
  readonly code = "RPC_POOL_EXHAUSTED";
  constructor(
    readonly method: string,
    readonly attempts: number,
    readonly lastError: unknown
  ) {
    super(
      `RPC call "${method}" failed on every endpoint after ${attempts} attempt(s): ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
    this.name = "RpcPoolExhaustedError";
  }
}

interface AffinityEntry {
  label: string;
  expiresAt: number;
}

/**
 * Single point of policy for every outbound Stellar RPC call: endpoint
 * selection, retry with backoff, failover, and transaction-hash affinity.
 *
 * Idempotency rules that must not be relaxed:
 *  - Reads are pure, so retry and failover are unconditionally safe.
 *  - `sendTransaction` carries a signed XDR bound to a fixed sequence number,
 *    so resubmitting the *identical* blob cannot double-spend — the second
 *    attempt comes back DUPLICATE. Retrying the same blob is safe; generating
 *    a new XDR is not, and this service never re-signs.
 *  - `getTransaction` must hit the endpoint that accepted the submission,
 *    because another node may not have seen it yet. Round-robin here produces
 *    phantom NOT_FOUND.
 */
@Injectable()
export class RpcClientService {
  private readonly logger = new Logger(RpcClientService.name);
  private readonly affinity = new Map<string, AffinityEntry>();

  constructor(
    private readonly pool: RpcPoolService,
    private readonly cache: RpcCacheService,
    private readonly metrics: RpcMetricsService
  ) {}

  /**
   * Invokes `method` on the best available endpoint, failing over on error.
   * Returns whatever the underlying `rpc.Server` method returns.
   */
  async call<T = unknown>(method: string, args: unknown[]): Promise<T> {
    const candidates = this.orderCandidates(method, args);

    if (candidates.length === 0) {
      throw new RpcPoolExhaustedError(method, 0, "no usable RPC endpoint");
    }

    const attempts = Math.min(MAX_ATTEMPTS, Math.max(candidates.length, 2));
    let lastError: unknown = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const endpoint = candidates[attempt % candidates.length];

      const startedAt = Date.now();

      try {
        const { value: result, cached } = await this.invoke<T>(
          endpoint,
          method,
          args
        );
        this.metrics.observeRequest(
          method,
          endpoint.config.label,
          cached ? "cached" : "ok",
          Date.now() - startedAt
        );

        if (method === "sendTransaction") {
          const status = (result as { status?: unknown } | null)?.status;
          this.metrics.observeTxSubmission(
            typeof status === "string" ? status : "unknown"
          );
        }

        // TRY_AGAIN_LATER means this node is congested, not that the tx is bad.
        // Resubmitting the identical XDR elsewhere is safe.
        if (
          method === "sendTransaction" &&
          isTryAgainLater(result) &&
          attempt < attempts - 1
        ) {
          lastError = new Error("sendTransaction returned TRY_AGAIN_LATER");
          this.pool.recordFailure(endpoint, lastError);
          await sleep(backoffFor(attempt));
          continue;
        }

        this.pool.recordSuccess(endpoint);
        this.rememberAffinity(method, result, endpoint);
        return result;
      } catch (err) {
        lastError = err;
        this.metrics.observeRequest(
          method,
          endpoint.config.label,
          "error",
          Date.now() - startedAt
        );
        this.pool.recordFailure(endpoint, err);
        this.logger.warn(
          `RPC ${method} failed on ${endpoint.config.label} (attempt ${
            attempt + 1
          }/${attempts}): ${err instanceof Error ? err.message : String(err)}`
        );

        if (attempt < attempts - 1) {
          const next = candidates[(attempt + 1) % candidates.length];
          if (next.config.label !== endpoint.config.label) {
            this.metrics.observeFailover(
              endpoint.config.label,
              next.config.label,
              classifyFailure(err)
            );
            this.logger.log(
              `RPC failover ${endpoint.config.label} -> ${next.config.label} for ${method}`
            );
          }
          await sleep(backoffFor(attempt));
        }
      }
    }

    throw new RpcPoolExhaustedError(method, attempts, lastError);
  }

  /** Exposed for the health indicator; the pool owns the real state. */
  isReadMethod(method: string): boolean {
    return READ_METHODS.has(method);
  }

  /**
   * Runs one call against one endpoint, serving it from cache where the method
   * allows it.
   *
   * Raw-cacheable methods go through the SDK's underscore variant, which
   * returns the unparsed wire response — plain JSON, and therefore safe to
   * store. The parser then runs on hit and miss alike, so a cached result is
   * structurally identical to a fresh one. Caching the parsed object instead
   * would destroy its XDR class instances.
   */
  private async invoke<T>(
    endpoint: PoolEndpoint,
    method: string,
    args: unknown[]
  ): Promise<{ value: T; cached: boolean }> {
    const plan = this.cache.planFor(method);

    if (plan.kind === "none" || !this.cache.isEnabled()) {
      return {
        value: await this.callServer<T>(endpoint, method, args),
        cached: false,
      };
    }

    const key = this.cache.buildKey(method, args);

    if (plan.kind === "plain") {
      const { value, hit } = await this.cache.through(key, plan.ttlMs, () =>
        this.callServer<T>(endpoint, method, args)
      );
      this.metrics.observeCache(method, hit ? "hit" : "miss");
      return { value, cached: hit };
    }

    const { value: raw, hit } = await this.cache.through(key, plan.ttlMs, () =>
      this.callServer<unknown>(endpoint, plan.rawMethod, args)
    );
    this.metrics.observeCache(method, hit ? "hit" : "miss");
    return { value: plan.parse(raw as never) as T, cached: hit };
  }

  private async callServer<T>(
    endpoint: PoolEndpoint,
    method: string,
    args: unknown[]
  ): Promise<T> {
    const server = endpoint.server as unknown as Record<string, unknown>;
    const fn = server[method];

    if (typeof fn !== "function") {
      throw new Error(`rpc.Server has no method "${method}"`);
    }

    return (fn as (...a: unknown[]) => Promise<T>).apply(endpoint.server, args);
  }

  /**
   * Pins hash-addressed lookups to the endpoint that accepted the submission,
   * then allows the rest of the pool as a fallback if that endpoint is failing
   * outright. A NOT_FOUND is a successful response and returns immediately, so
   * the fallback only ever engages on transport errors.
   */
  private orderCandidates(method: string, args: unknown[]): PoolEndpoint[] {
    const candidates = this.pool.candidates();

    if (!HASH_AFFINITY_METHODS.has(method)) return candidates;

    const hash = typeof args[0] === "string" ? args[0] : null;
    if (!hash) return candidates;

    const pinnedLabel = this.lookupAffinity(hash);
    if (!pinnedLabel) return candidates;

    const pinned = candidates.find((e) => e.config.label === pinnedLabel);
    if (!pinned) return candidates;

    return [pinned, ...candidates.filter((e) => e !== pinned)];
  }

  private rememberAffinity(
    method: string,
    result: unknown,
    endpoint: PoolEndpoint
  ): void {
    if (method !== "sendTransaction") return;

    const hash = (result as { hash?: unknown } | null)?.hash;
    if (typeof hash !== "string" || !hash) return;

    if (this.affinity.size >= AFFINITY_MAX_ENTRIES) {
      this.pruneAffinity();
    }

    this.affinity.set(hash, {
      label: endpoint.config.label,
      expiresAt: Date.now() + AFFINITY_TTL_MS,
    });
  }

  private lookupAffinity(hash: string): string | null {
    const entry = this.affinity.get(hash);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.affinity.delete(hash);
      return null;
    }
    return entry.label;
  }

  private pruneAffinity(): void {
    const now = Date.now();
    for (const [hash, entry] of this.affinity) {
      if (entry.expiresAt <= now) this.affinity.delete(hash);
    }
    // Still full of live entries — drop the oldest insertions.
    if (this.affinity.size >= AFFINITY_MAX_ENTRIES) {
      const overflow = this.affinity.size - AFFINITY_MAX_ENTRIES + 1;
      let dropped = 0;
      for (const hash of this.affinity.keys()) {
        if (dropped >= overflow) break;
        this.affinity.delete(hash);
        dropped += 1;
      }
    }
  }
}

/** Coarse failure reason, kept low-cardinality so it is safe as a label. */
function classifyFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) return "dns";
  if (/ECONNREFUSED|ECONNRESET|EPIPE/i.test(message)) return "connection";
  if (/timed? ?out|ETIMEDOUT/i.test(message)) return "timeout";
  if (/\b429\b|too many requests|rate limit/i.test(message))
    return "rate_limited";
  if (/\b5\d\d\b/.test(message)) return "upstream_5xx";
  if (/TRY_AGAIN_LATER/.test(message)) return "try_again_later";
  return "other";
}

function isTryAgainLater(result: unknown): boolean {
  return (result as { status?: unknown } | null)?.status === "TRY_AGAIN_LATER";
}

function backoffFor(attempt: number): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  // Full jitter — avoids every in-flight request retrying in lockstep.
  return Math.floor(Math.random() * exponential);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
