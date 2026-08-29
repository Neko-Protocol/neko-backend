import { Injectable } from "@nestjs/common";
import { Counter, Gauge, Histogram, Registry } from "prom-client";

/**
 * Outcome of a single upstream RPC attempt.
 *
 * `cached` never reaches an endpoint at all, so it is tracked separately from
 * `ok` — folding the two together would make the cache look like it improved
 * upstream latency when it actually avoided the call.
 */
export type RpcOutcome = "ok" | "error" | "cached";

/**
 * Buckets in seconds. The low end has to resolve cache hits (single-digit
 * milliseconds) and the high end has to show a provider timing out, so the
 * range is deliberately wide.
 */
const DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10,
];

/**
 * Prometheus metrics for the RPC gateway.
 *
 * The dimension that matters is outbound: latency and success rate *per RPC
 * method, per upstream endpoint*. Generic HTTP instrumentation only sees the
 * inbound request and cannot answer whether getLedgerEntries is slower on the
 * failover than on the primary.
 *
 * A private Registry rather than the global default keeps the exposition to
 * our own series plus explicitly chosen defaults, which keeps cardinality
 * predictable.
 */
@Injectable()
export class RpcMetricsService {
  readonly registry = new Registry();

  private readonly duration = new Histogram({
    name: "neko_rpc_request_duration_seconds",
    help: "Duration of an RPC call, by method, upstream endpoint and outcome.",
    labelNames: ["method", "endpoint", "outcome"] as const,
    buckets: DURATION_BUCKETS,
    registers: [this.registry],
  });

  private readonly requests = new Counter({
    name: "neko_rpc_requests_total",
    help: "RPC calls, by method, upstream endpoint and outcome.",
    labelNames: ["method", "endpoint", "outcome"] as const,
    registers: [this.registry],
  });

  private readonly failovers = new Counter({
    name: "neko_rpc_failover_total",
    help: "Times a call moved from one endpoint to the next.",
    labelNames: ["from", "to", "reason"] as const,
    registers: [this.registry],
  });

  private readonly cache = new Counter({
    name: "neko_rpc_cache_total",
    help: "Cache lookups, by method and result.",
    labelNames: ["method", "result"] as const,
    registers: [this.registry],
  });

  private readonly endpointUp = new Gauge({
    name: "neko_rpc_endpoint_up",
    help: "1 when an endpoint is serving, 0 when its breaker is open.",
    labelNames: ["endpoint", "state"] as const,
    registers: [this.registry],
  });

  private readonly ledgerLag = new Gauge({
    name: "neko_rpc_endpoint_ledger_lag",
    help: "Ledgers an endpoint trails the furthest-ahead endpoint in the pool.",
    labelNames: ["endpoint"] as const,
    registers: [this.registry],
  });

  private readonly txSubmissions = new Counter({
    name: "neko_tx_submissions_total",
    help: "Transaction submissions, by the status the network returned.",
    labelNames: ["outcome"] as const,
    registers: [this.registry],
  });

  constructor() {
    this.registry.setDefaultLabels({ service: "neko-backend" });
  }

  observeRequest(
    method: string,
    endpoint: string,
    outcome: RpcOutcome,
    durationMs: number
  ): void {
    const labels = { method, endpoint, outcome };
    this.requests.inc(labels);
    this.duration.observe(labels, durationMs / 1000);
  }

  observeFailover(from: string, to: string, reason: string): void {
    this.failovers.inc({ from, to, reason });
  }

  observeCache(method: string, result: "hit" | "miss"): void {
    this.cache.inc({ method, result });
  }

  /**
   * Called after each health sweep. `up` is 1 for both healthy and degraded
   * endpoints — a degraded one is still serving, last in line — so the `state`
   * label carries the distinction the gauge alone cannot.
   */
  observeEndpointState(
    endpoint: string,
    state: string,
    ledgerLag: number | null
  ): void {
    this.endpointUp.set({ endpoint, state }, state === "down" ? 0 : 1);
    if (ledgerLag !== null) {
      this.ledgerLag.set({ endpoint }, ledgerLag);
    }
  }

  observeTxSubmission(outcome: string): void {
    this.txSubmissions.inc({ outcome });
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }
}
