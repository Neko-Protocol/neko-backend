import { RpcOverviewService } from "./rpc-overview.service";
import type { MetricsRegistryService } from "@core/observability/metrics/metrics-registry.service";
import type { RpcPoolService } from "@core/rpc/pool/rpc-pool.service";

function makeMetrics(values: Record<string, unknown[]>) {
  return {
    registry: {
      getMetricsAsJSON: async () =>
        Object.entries(values).map(([name, vs]) => ({ name, values: vs })),
    },
  } as unknown as MetricsRegistryService;
}

function makePool(endpoints: unknown[]) {
  return { snapshot: () => endpoints } as unknown as RpcPoolService;
}

const ENDPOINTS = [
  { label: "validation_cloud", state: "up" },
  { label: "onfinality", state: "down" },
  { label: "quasar", state: "degraded" },
];

describe("RpcOverviewService", () => {
  it("counts a degraded endpoint as usable", async () => {
    // Degraded means "reachable but its ledger trails" — the pool still routes
    // to it once healthy endpoints are exhausted, so calling it unusable would
    // understate what the system can serve.
    const svc = new RpcOverviewService(makePool(ENDPOINTS), makeMetrics({}));

    const snap = await svc.getSnapshot();

    expect(snap.usableCount).toBe(2);
    expect(snap.endpoints).toHaveLength(3);
  });

  it("splits request counters by method and by endpoint", async () => {
    const svc = new RpcOverviewService(
      makePool([]),
      makeMetrics({
        neko_rpc_requests_total: [
          {
            value: 90,
            labels: {
              method: "simulateTransaction",
              endpoint: "validation_cloud",
              outcome: "ok",
            },
          },
          {
            value: 10,
            labels: {
              method: "simulateTransaction",
              endpoint: "validation_cloud",
              outcome: "error",
            },
          },
          {
            value: 5,
            labels: {
              method: "getEvents",
              endpoint: "quasar",
              outcome: "ok",
            },
          },
        ],
      })
    );

    const snap = await svc.getSnapshot();

    expect(snap.byMethod[0]).toEqual({
      method: "simulateTransaction",
      ok: 90,
      error: 10,
      successRate: 0.9,
    });
    expect(snap.byEndpoint).toEqual([
      { endpoint: "validation_cloud", ok: 90, error: 10 },
      { endpoint: "quasar", ok: 5, error: 0 },
    ]);
    expect(snap.totals).toEqual({ ok: 95, error: 10, successRate: 95 / 105 });
  });

  it("reports no traffic as an unknown rate, not as zero", async () => {
    // Zero would read as a total outage on an idle backend, which is the same
    // mistake that made the Grafana success-rate alert fire on an empty window.
    const svc = new RpcOverviewService(makePool([]), makeMetrics({}));

    const snap = await svc.getSnapshot();

    expect(snap.totals).toEqual({ ok: 0, error: 0, successRate: null });
    expect(snap.byMethod).toEqual([]);
  });

  it("derives a cache hit rate per method", async () => {
    const svc = new RpcOverviewService(
      makePool([]),
      makeMetrics({
        neko_rpc_cache_total: [
          {
            value: 75,
            labels: { method: "simulateTransaction", result: "hit" },
          },
          {
            value: 25,
            labels: { method: "simulateTransaction", result: "miss" },
          },
        ],
      })
    );

    const snap = await svc.getSnapshot();

    expect(snap.cache).toEqual([
      { method: "simulateTransaction", hit: 75, miss: 25, hitRate: 0.75 },
    ]);
  });

  it("orders failovers by how often they happened", async () => {
    const svc = new RpcOverviewService(
      makePool([]),
      makeMetrics({
        neko_rpc_failover_total: [
          { value: 2, labels: { from: "a", to: "b", reason: "connection" } },
          { value: 9, labels: { from: "c", to: "d", reason: "stale" } },
        ],
      })
    );

    const snap = await svc.getSnapshot();

    expect(snap.failovers.map((f) => f.count)).toEqual([9, 2]);
  });
});
