import { Injectable } from "@nestjs/common";
import { MetricsRegistryService } from "@core/observability/metrics/metrics-registry.service";
import {
  RpcPoolService,
  type EndpointSnapshot,
} from "@core/rpc/pool/rpc-pool.service";

export interface MethodUsage {
  method: string;
  ok: number;
  error: number;
  successRate: number | null;
}

export interface EndpointUsage {
  endpoint: string;
  ok: number;
  error: number;
}

export interface CacheUsage {
  method: string;
  hit: number;
  miss: number;
  hitRate: number | null;
}

export interface FailoverEvent {
  from: string;
  to: string;
  reason: string;
  count: number;
}

export interface InfrastructureSnapshot {
  endpoints: EndpointSnapshot[];
  usableCount: number;
  byMethod: MethodUsage[];
  byEndpoint: EndpointUsage[];
  cache: CacheUsage[];
  failovers: FailoverEvent[];
  /** Totals across every method, so the page can lead with one number. */
  totals: { ok: number; error: number; successRate: number | null };
  collectedAt: string;
}

/** A Prometheus counter sample as prom-client reports it. */
interface Sample {
  value: number;
  labels: Record<string, string | number>;
}

function rate(part: number, whole: number): number | null {
  // No traffic is not zero percent. Reporting 0 would make an idle backend
  // look broken, which is the same mistake that made the Grafana alert page
  // on an empty window.
  return whole > 0 ? part / whole : null;
}

@Injectable()
export class InfrastructureService {
  constructor(
    private readonly pool: RpcPoolService,
    private readonly metrics: MetricsRegistryService
  ) {}

  /**
   * The pool's live state plus the counters behind the Grafana dashboard,
   * shaped for a UI rather than for a scraper.
   *
   * Reads the same registry `/metrics` serves, so the admin sees exactly what
   * Grafana sees without a second source of truth — and without the dashboard
   * having to be exposed publicly to be looked at.
   */
  async getSnapshot(): Promise<InfrastructureSnapshot> {
    const metrics = await this.metrics.registry.getMetricsAsJSON();
    const samples = (name: string): Sample[] =>
      ((metrics.find((m) => m.name === name)?.values ?? []) as Sample[]).map(
        (s) => ({ value: s.value, labels: s.labels ?? {} })
      );

    const requests = samples("neko_rpc_requests_total");
    const cacheSamples = samples("neko_rpc_cache_total");
    const failoverSamples = samples("neko_rpc_failover_total");

    const endpoints = this.pool.snapshot();

    return {
      endpoints,
      usableCount: endpoints.filter((e) => e.state !== "down").length,
      byMethod: this.groupRequests(requests, "method").map(
        ([method, ok, error]) => ({
          method,
          ok,
          error,
          successRate: rate(ok, ok + error),
        })
      ),
      byEndpoint: this.groupRequests(requests, "endpoint").map(
        ([endpoint, ok, error]) => ({ endpoint, ok, error })
      ),
      cache: this.groupCache(cacheSamples),
      failovers: failoverSamples
        .map((s) => ({
          from: String(s.labels.from ?? "?"),
          to: String(s.labels.to ?? "?"),
          reason: String(s.labels.reason ?? "?"),
          count: s.value,
        }))
        .sort((a, b) => b.count - a.count),
      totals: this.totals(requests),
      collectedAt: new Date().toISOString(),
    };
  }

  /** Collapses request samples to [key, ok, error] triples. */
  private groupRequests(
    samples: Sample[],
    by: "method" | "endpoint"
  ): [string, number, number][] {
    const acc = new Map<string, { ok: number; error: number }>();
    for (const s of samples) {
      const key = String(s.labels[by] ?? "unknown");
      const entry = acc.get(key) ?? { ok: 0, error: 0 };
      if (s.labels.outcome === "ok") entry.ok += s.value;
      else entry.error += s.value;
      acc.set(key, entry);
    }
    return [...acc.entries()]
      .map(([k, v]): [string, number, number] => [k, v.ok, v.error])
      .sort((a, b) => b[1] + b[2] - (a[1] + a[2]));
  }

  private groupCache(samples: Sample[]): CacheUsage[] {
    const acc = new Map<string, { hit: number; miss: number }>();
    for (const s of samples) {
      const method = String(s.labels.method ?? "unknown");
      const entry = acc.get(method) ?? { hit: 0, miss: 0 };
      if (s.labels.result === "hit") entry.hit += s.value;
      else entry.miss += s.value;
      acc.set(method, entry);
    }
    return [...acc.entries()]
      .map(([method, v]) => ({
        method,
        hit: v.hit,
        miss: v.miss,
        hitRate: rate(v.hit, v.hit + v.miss),
      }))
      .sort((a, b) => b.hit + b.miss - (a.hit + a.miss));
  }

  private totals(samples: Sample[]): InfrastructureSnapshot["totals"] {
    let ok = 0;
    let error = 0;
    for (const s of samples) {
      if (s.labels.outcome === "ok") ok += s.value;
      else error += s.value;
    }
    return { ok, error, successRate: rate(ok, ok + error) };
  }
}
