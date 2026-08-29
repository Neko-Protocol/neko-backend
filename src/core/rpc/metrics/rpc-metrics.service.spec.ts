import { MetricsRegistryService } from "../../observability/metrics/metrics-registry.service";
import { RpcMetricsService } from "./rpc-metrics.service";

let registry: MetricsRegistryService;

async function seriesFor(name: string): Promise<string[]> {
  const text = await registry.metrics();
  return text.split("\n").filter((line: string) => line.startsWith(name));
}

describe("RpcMetricsService", () => {
  let metrics: RpcMetricsService;

  beforeEach(() => {
    registry = new MetricsRegistryService();
    metrics = new RpcMetricsService(registry);
  });

  describe("requests", () => {
    it("labels a call by method, endpoint and outcome", async () => {
      metrics.observeRequest("simulateTransaction", "quasar", "ok", 120);

      const [line] = await seriesFor("neko_rpc_requests_total{");

      expect(line).toContain('method="simulateTransaction"');
      expect(line).toContain('endpoint="quasar"');
      expect(line).toContain('outcome="ok"');
      expect(line).toMatch(/ 1$/);
    });

    it("keeps the same endpoint separate per outcome", async () => {
      metrics.observeRequest("getNetwork", "quasar", "ok", 10);
      metrics.observeRequest("getNetwork", "quasar", "error", 10);

      const lines = await seriesFor("neko_rpc_requests_total{");

      expect(lines).toHaveLength(2);
    });

    it("distinguishes a cache hit from an upstream success", async () => {
      // Folding these together would make the cache look like it improved
      // upstream latency when it actually avoided the call.
      metrics.observeRequest("simulateTransaction", "quasar", "cached", 3);

      const [line] = await seriesFor("neko_rpc_requests_total{");

      expect(line).toContain('outcome="cached"');
    });

    it("records duration in seconds, not milliseconds", async () => {
      metrics.observeRequest("getNetwork", "quasar", "ok", 250);

      const text = await registry.metrics();
      const sum = text
        .split("\n")
        .find((l) => l.startsWith("neko_rpc_request_duration_seconds_sum"));

      expect(sum).toContain("0.25");
    });
  });

  describe("failover", () => {
    it("records the pair of endpoints and the reason", async () => {
      metrics.observeFailover("validation_cloud", "onfinality", "timeout");

      const [line] = await seriesFor("neko_rpc_failover_total{");

      expect(line).toContain('from="validation_cloud"');
      expect(line).toContain('to="onfinality"');
      expect(line).toContain('reason="timeout"');
    });
  });

  describe("cache", () => {
    it("counts hits and misses separately per method", async () => {
      metrics.observeCache("simulateTransaction", "hit");
      metrics.observeCache("simulateTransaction", "hit");
      metrics.observeCache("simulateTransaction", "miss");

      const lines = await seriesFor("neko_rpc_cache_total{");
      const hit = lines.find((l) => l.includes('result="hit"'));
      const miss = lines.find((l) => l.includes('result="miss"'));

      expect(hit).toMatch(/ 2$/);
      expect(miss).toMatch(/ 1$/);
    });
  });

  describe("endpoint state", () => {
    it("reports a healthy endpoint as up", async () => {
      metrics.observeEndpointState("quasar", "up", 0);

      const [line] = await seriesFor("neko_rpc_endpoint_up{");

      expect(line).toContain('state="up"');
      expect(line).toMatch(/ 1$/);
    });

    it("still reports a degraded endpoint as up — it is last in line, not out", async () => {
      metrics.observeEndpointState("gateway_fm", "degraded", 12);

      const [line] = await seriesFor("neko_rpc_endpoint_up{");

      expect(line).toContain('state="degraded"');
      expect(line).toMatch(/ 1$/);
    });

    it("reports a downed endpoint as zero", async () => {
      metrics.observeEndpointState("gateway_fm", "down", null);

      const [line] = await seriesFor("neko_rpc_endpoint_up{");

      expect(line).toMatch(/ 0$/);
    });

    it("publishes ledger lag when known", async () => {
      metrics.observeEndpointState("gateway_fm", "degraded", 12);

      const [line] = await seriesFor("neko_rpc_endpoint_ledger_lag{");

      expect(line).toMatch(/ 12$/);
    });

    it("leaves lag unset rather than reporting a misleading zero", async () => {
      metrics.observeEndpointState("gateway_fm", "down", null);

      const lines = await seriesFor("neko_rpc_endpoint_ledger_lag{");

      expect(lines).toHaveLength(0);
    });
  });

  describe("transaction submissions", () => {
    it("counts by the status the network returned", async () => {
      metrics.observeTxSubmission("PENDING");
      metrics.observeTxSubmission("DUPLICATE");

      const lines = await seriesFor("neko_tx_submissions_total{");

      expect(lines).toHaveLength(2);
      expect(lines.join()).toContain('outcome="DUPLICATE"');
    });
  });

  describe("exposition", () => {
    it("serves the Prometheus text content type", () => {
      expect(registry.contentType()).toContain("text/plain");
    });

    it("tags every series with the service name", async () => {
      metrics.observeRequest("getNetwork", "quasar", "ok", 1);

      const [line] = await seriesFor("neko_rpc_requests_total{");

      expect(line).toContain('service="neko-backend"');
    });

    it("exposes only our own series, keeping cardinality predictable", async () => {
      metrics.observeRequest("getNetwork", "quasar", "ok", 1);

      const names = (await registry.metrics())
        .split("\n")
        .filter((l: string) => l.startsWith("# HELP"))
        .map((l: string) => l.split(" ")[2]);

      expect(names.every((n) => n.startsWith("neko_"))).toBe(true);
    });
  });
});
