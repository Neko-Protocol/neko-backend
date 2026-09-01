import {
  Account,
  Address,
  Contract,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { RedisCacheService } from "../../cache/redis-cache.service";
import { RpcCacheService } from "./rpc-cache.service";

const WALLET = "GDCK6VGEMRV52C6UO7Q4FJDFDF5AHKA3SWTSAHJNS3QIKRW6U5L7XYMJ";
const TOKEN = "CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV";
const OTHER_TOKEN = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const PASSPHRASE = "Public Global Stellar Network ; September 2015";

/** A balance read, exactly as @neko/orchestrator builds one. */
function balanceEnvelope(contract = TOKEN, sequence = "12345"): string {
  return (
    new TransactionBuilder(new Account(WALLET, sequence), {
      fee: "100",
      networkPassphrase: PASSPHRASE,
    })
      .addOperation(
        new Contract(contract).call("balance", new Address(WALLET).toScVal())
      )
      // Bakes `now + 300` into the envelope — the reason the key used to move.
      .setTimeout(300)
      .build()
      .toXDR()
  );
}

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
      expect(plan.ttlMs).toBe(30_000);
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

  describe("buildKey: simulateTransaction", () => {
    // The cache reported 0 hits against 373 misses because the validity window
    // moved with the clock, so no two identical reads ever shared a key.
    it("gives the same key to the same read built at a different moment", () => {
      const svc = makeService();
      jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const first = svc.buildKey("simulateTransaction", [
        { transaction: balanceEnvelope() },
      ]);
      jest.setSystemTime(new Date("2026-01-01T00:00:05Z"));
      const second = svc.buildKey("simulateTransaction", [
        { transaction: balanceEnvelope() },
      ]);
      jest.useRealTimers();

      expect(second).toBe(first);
    });

    it("still separates different tokens", () => {
      const svc = makeService();
      expect(
        svc.buildKey("simulateTransaction", [
          { transaction: balanceEnvelope(TOKEN) },
        ])
      ).not.toBe(
        svc.buildKey("simulateTransaction", [
          { transaction: balanceEnvelope(OTHER_TOKEN) },
        ])
      );
    });

    // A wallet that transacts moves its sequence, which is how its cached
    // balances get dropped without anyone invalidating them.
    it("still separates sequence numbers", () => {
      const svc = makeService();
      expect(
        svc.buildKey("simulateTransaction", [
          { transaction: balanceEnvelope(TOKEN, "12345") },
        ])
      ).not.toBe(
        svc.buildKey("simulateTransaction", [
          { transaction: balanceEnvelope(TOKEN, "12346") },
        ])
      );
    });

    it("falls back to the exact key when the envelope cannot be parsed", () => {
      const svc = makeService();
      expect(() =>
        svc.buildKey("simulateTransaction", [{ transaction: "not-xdr" }])
      ).not.toThrow();
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
