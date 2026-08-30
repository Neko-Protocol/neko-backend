import { RedisCacheService } from "../../cache/redis-cache.service";
import { RpcCacheService } from "./rpc-cache.service";

/**
 * These tests cover the RPC caching *policy* — which methods may be cached and
 * how their keys are derived. Storage behaviour (fail-open, single-flight)
 * lives in redis-cache.service.spec.ts.
 */
function makeService(enabled = false): RpcCacheService {
  const store = {
    isEnabled: () => enabled,
    through: async (_k: string, _t: number, fetch: () => Promise<unknown>) => ({
      value: await fetch(),
      hit: false,
    }),
    invalidate: async () => undefined,
  } as unknown as RedisCacheService;
  return new RpcCacheService(store);
}

describe("RpcCacheService", () => {
  describe("planFor", () => {
    it("caches simulateTransaction through the raw wire response", () => {
      const plan = makeService().planFor("simulateTransaction");

      expect(plan.kind).toBe("raw");
      if (plan.kind !== "raw") return;
      // The parsed object holds xdr.ScVal class instances that do not survive
      // JSON, so the raw response is what gets stored.
      expect(plan.rawMethod).toBe("_simulateTransaction");
      expect(typeof plan.parse).toBe("function");
      expect(plan.ttlMs).toBe(5_000);
    });

    it("caches getLatestLedger as plain JSON", () => {
      const plan = makeService().planFor("getLatestLedger");

      expect(plan.kind).toBe("plain");
      if (plan.kind !== "plain") return;
      expect(plan.ttlMs).toBe(2_000);
    });

    it("never caches sendTransaction", () => {
      const plan = makeService().planFor("sendTransaction");

      expect(plan.kind).toBe("none");
      if (plan.kind !== "none") return;
      expect(plan.reason).toMatch(/write path/);
    });

    it("never caches getAccount — a stale sequence number breaks signing", () => {
      const plan = makeService().planFor("getAccount");

      expect(plan.kind).toBe("none");
      if (plan.kind !== "none") return;
      expect(plan.reason).toMatch(/sequence number/);
    });

    it("never caches getTransaction while its parser is unreachable", () => {
      expect(makeService().planFor("getTransaction").kind).toBe("none");
    });

    it("defaults an unknown method to uncached", () => {
      const plan = makeService().planFor("someNewSdkMethod");

      expect(plan.kind).toBe("none");
      if (plan.kind !== "none") return;
      expect(plan.reason).toMatch(/not in the cacheable set/);
    });
  });

  describe("buildKey", () => {
    it("is stable across argument key ordering", () => {
      const svc = makeService();

      const a = svc.buildKey("getEvents", [{ startLedger: 1, limit: 10 }]);
      const b = svc.buildKey("getEvents", [{ limit: 10, startLedger: 1 }]);

      expect(a).toBe(b);
    });

    it("separates different arguments", () => {
      const svc = makeService();

      expect(svc.buildKey("getEvents", [{ limit: 10 }])).not.toBe(
        svc.buildKey("getEvents", [{ limit: 20 }])
      );
    });

    it("separates different methods with identical arguments", () => {
      const svc = makeService();

      expect(svc.buildKey("getNetwork", [])).not.toBe(
        svc.buildKey("getLatestLedger", [])
      );
    });

    it("keys XDR-bearing arguments by their canonical XDR form", () => {
      const svc = makeService();
      const tx = { toXDR: () => "AAAAAgAAAA==" };
      const same = { toXDR: () => "AAAAAgAAAA==" };
      const other = { toXDR: () => "BBBBBgBBBB==" };

      expect(svc.buildKey("simulateTransaction", [tx])).toBe(
        svc.buildKey("simulateTransaction", [same])
      );
      expect(svc.buildKey("simulateTransaction", [tx])).not.toBe(
        svc.buildKey("simulateTransaction", [other])
      );
    });
  });
});
