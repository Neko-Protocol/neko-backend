import { Injectable, Logger } from "@nestjs/common";
import { RpcCacheService } from "../cache/rpc-cache.service";
import { RpcMetricsService } from "../metrics/rpc-metrics.service";
import { PoolEndpoint, RpcPoolService } from "../pool/rpc-pool.service";

/**
 * A single JSON-RPC request as it arrives from a browser.
 *
 * `id` is echoed back untouched: the client correlates responses by it, and
 * the SDK will hang waiting if it comes back changed.
 */
export interface JsonRpcRequest {
  jsonrpc: string;
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Max attempts across the pool for one forwarded call. */
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 120;
const MAX_BACKOFF_MS = 1_500;
const UPSTREAM_TIMEOUT_MS = 20_000;

/**
 * Forwards raw JSON-RPC to the endpoint pool.
 *
 * Distinct from RpcClientService, which calls typed `rpc.Server` methods on
 * behalf of backend code. A browser speaks raw JSON-RPC, and re-encoding its
 * payload into SDK calls and back would mean maintaining a translation layer
 * for every method — and would lose anything the SDK does not model.
 *
 * Forwarding the wire format verbatim also composes with the cache, which
 * already stores raw responses precisely because parsed ones do not survive
 * JSON.
 */
@Injectable()
export class RpcForwarderService {
  private readonly logger = new Logger(RpcForwarderService.name);

  constructor(
    private readonly pool: RpcPoolService,
    private readonly cache: RpcCacheService,
    private readonly metrics: RpcMetricsService
  ) {}

  async forward(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const plan = this.cache.planFor(request.method);
    const params = request.params ?? {};

    // Only the result is cached, never the envelope — `id` is per-request and
    // caching it would hand one client another client's correlation id.
    if (plan.kind !== "none" && this.cache.isEnabled()) {
      const key = this.cache.buildKey(request.method, [params]);
      const { value, hit } = await this.cache.through(key, plan.ttlMs, () =>
        this.execute(request)
      );
      this.metrics.observeCache(request.method, hit ? "hit" : "miss");
      return { jsonrpc: "2.0", id: request.id, result: value };
    }

    const result = await this.execute(request);
    return { jsonrpc: "2.0", id: request.id, result };
  }

  /**
   * Runs the call against the pool, failing over on error. Returns the bare
   * `result` so the caller owns the envelope.
   */
  private async execute(request: JsonRpcRequest): Promise<unknown> {
    const candidates = this.pool.candidates();
    if (candidates.length === 0) {
      throw new Error("no usable RPC endpoint");
    }

    const attempts = Math.min(MAX_ATTEMPTS, Math.max(candidates.length, 2));
    let lastError: unknown = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const endpoint = candidates[attempt % candidates.length];
      const startedAt = Date.now();

      try {
        const result = await this.post(endpoint, request);
        this.pool.recordSuccess(endpoint);
        this.metrics.observeRequest(
          request.method,
          endpoint.config.label,
          "ok",
          Date.now() - startedAt
        );
        if (request.method === "sendTransaction") {
          const status = (result as { status?: unknown } | null)?.status;
          this.metrics.observeTxSubmission(
            typeof status === "string" ? status : "unknown"
          );
        }
        return result;
      } catch (err) {
        lastError = err;
        this.pool.recordFailure(endpoint, err);
        this.metrics.observeRequest(
          request.method,
          endpoint.config.label,
          "error",
          Date.now() - startedAt
        );

        if (attempt < attempts - 1) {
          const next = candidates[(attempt + 1) % candidates.length];
          if (next.config.label !== endpoint.config.label) {
            this.metrics.observeFailover(
              endpoint.config.label,
              next.config.label,
              classify(err)
            );
            this.logger.warn(
              `RPC forward ${request.method} failed on ${endpoint.config.label}, trying ${next.config.label}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
          await sleep(backoffFor(attempt));
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError ?? "forward failed"));
  }

  private async post(
    endpoint: PoolEndpoint,
    request: JsonRpcRequest
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint.config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...endpoint.config.headers,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          // The upstream id is ours, not the client's: correlation happens
          // per-hop, and echoing a client-controlled value upstream is a
          // needless passthrough of untrusted input.
          id: 1,
          method: request.method,
          params: request.params ?? {},
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`upstream returned ${response.status}`);
      }

      const body = (await response.json()) as {
        result?: unknown;
        error?: { message?: string };
      };

      if (body.error) {
        // A JSON-RPC error is the upstream's considered answer, not a
        // transport failure — but it still warrants trying another endpoint,
        // since a healthy one may answer correctly.
        throw new Error(body.error.message ?? "upstream JSON-RPC error");
      }

      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Coarse failure reason, kept low-cardinality so it is safe as a label. */
function classify(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/abort/i.test(message)) return "timeout";
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) return "dns";
  if (/ECONNREFUSED|ECONNRESET|EPIPE|fetch failed/i.test(message))
    return "connection";
  if (/\b429\b|too many requests|rate limit/i.test(message))
    return "rate_limited";
  if (/\b5\d\d\b/.test(message)) return "upstream_5xx";
  return "other";
}

function backoffFor(attempt: number): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return Math.floor(Math.random() * exponential);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
