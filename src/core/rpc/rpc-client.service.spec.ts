import { RpcClientService, RpcPoolExhaustedError } from "./rpc-client.service";
import { RpcCacheService } from "./rpc-cache.service";
import { RpcMetricsService } from "./rpc-metrics.service";
import { PoolEndpoint, RpcPoolService } from "./rpc-pool.service";

interface FakeEndpoint extends PoolEndpoint {
  server: PoolEndpoint["server"] & Record<string, jest.Mock>;
}

function makeEndpoint(label: string, priority: number): FakeEndpoint {
  return {
    config: {
      label,
      url: `https://${label}.example.com`,
      priority,
      headers: {},
      allowHttp: false,
    },
    server: {} as FakeEndpoint["server"],
    state: "up",
    consecutiveFailures: 0,
    breakerOpenedAt: null,
    latestLedger: null,
    ledgerLag: null,
    lastCheckedAt: null,
    lastError: null,
  };
}

function makePool(endpoints: FakeEndpoint[]) {
  const pool = {
    candidates: jest.fn(() => endpoints.filter((e) => e.state !== "down")),
    recordSuccess: jest.fn((e: FakeEndpoint) => {
      e.consecutiveFailures = 0;
    }),
    recordFailure: jest.fn((e: FakeEndpoint) => {
      e.consecutiveFailures += 1;
    }),
  } as unknown as RpcPoolService;
  return pool;
}

describe("RpcClientService", () => {
  let alpha: FakeEndpoint;
  let bravo: FakeEndpoint;
  let charlie: FakeEndpoint;
  let client: RpcClientService;
  let pool: RpcPoolService;
  let cache: RpcCacheService;
  let metrics: RpcMetricsService;

  beforeEach(() => {
    // Full-jitter backoff with random()=0 collapses every sleep to 0ms.
    jest.spyOn(Math, "random").mockReturnValue(0);

    alpha = makeEndpoint("alpha", 0);
    bravo = makeEndpoint("bravo", 1);
    charlie = makeEndpoint("charlie", 2);
    pool = makePool([alpha, bravo, charlie]);
    // Caching disabled: these tests cover routing, not the cache. The
    // cache has its own suite.
    cache = {
      planFor: () => ({ kind: "none", reason: "disabled in test" }),
      isEnabled: () => false,
      buildKey: () => "unused",
      through: async (
        _k: string,
        _t: number,
        exec: () => Promise<unknown>
      ) => ({
        value: await exec(),
        hit: false,
      }),
    } as unknown as RpcCacheService;
    metrics = new RpcMetricsService();
    client = new RpcClientService(pool, cache, metrics);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("happy path", () => {
    it("calls the highest-priority endpoint and returns its result", async () => {
      alpha.server.getLatestLedger = jest.fn().mockResolvedValue({
        sequence: 42,
      });

      const result = await client.call("getLatestLedger", []);

      expect(result).toEqual({ sequence: 42 });
      expect(alpha.server.getLatestLedger).toHaveBeenCalledTimes(1);
      expect(pool.recordSuccess).toHaveBeenCalledWith(alpha);
    });

    it("forwards arguments through to the underlying method", async () => {
      alpha.server.getLedgerEntries = jest.fn().mockResolvedValue({
        entries: [],
      });

      await client.call("getLedgerEntries", ["key-a", "key-b"]);

      expect(alpha.server.getLedgerEntries).toHaveBeenCalledWith(
        "key-a",
        "key-b"
      );
    });
  });

  describe("failover", () => {
    it("degrades to the next endpoint when the primary throws", async () => {
      alpha.server.getLatestLedger = jest
        .fn()
        .mockRejectedValue(new Error("ECONNREFUSED"));
      bravo.server.getLatestLedger = jest
        .fn()
        .mockResolvedValue({ sequence: 7 });

      const result = await client.call("getLatestLedger", []);

      expect(result).toEqual({ sequence: 7 });
      expect(pool.recordFailure).toHaveBeenCalledWith(alpha, expect.anything());
      expect(pool.recordSuccess).toHaveBeenCalledWith(bravo);
    });

    it("keeps failing over across the whole pool", async () => {
      alpha.server.getLatestLedger = jest
        .fn()
        .mockRejectedValue(new Error("down"));
      bravo.server.getLatestLedger = jest
        .fn()
        .mockRejectedValue(new Error("down"));
      charlie.server.getLatestLedger = jest
        .fn()
        .mockResolvedValue({ sequence: 9 });

      await expect(client.call("getLatestLedger", [])).resolves.toEqual({
        sequence: 9,
      });
    });

    it("throws a typed error, not an unhandled rejection, once retries are exhausted", async () => {
      for (const endpoint of [alpha, bravo, charlie]) {
        endpoint.server.getLatestLedger = jest
          .fn()
          .mockRejectedValue(new Error("everything is down"));
      }

      await expect(client.call("getLatestLedger", [])).rejects.toBeInstanceOf(
        RpcPoolExhaustedError
      );
    });

    it("throws immediately when the pool has no usable endpoint", async () => {
      alpha.state = "down";
      bravo.state = "down";
      charlie.state = "down";

      await expect(client.call("getLatestLedger", [])).rejects.toThrow(
        /no usable RPC endpoint/
      );
    });
  });

  describe("sendTransaction idempotency", () => {
    it("never re-signs — the identical arguments are replayed on failover", async () => {
      const tx = { signed: "xdr-blob" };
      alpha.server.sendTransaction = jest
        .fn()
        .mockRejectedValue(new Error("timeout"));
      bravo.server.sendTransaction = jest
        .fn()
        .mockResolvedValue({ status: "PENDING", hash: "abc" });

      await client.call("sendTransaction", [tx]);

      expect(alpha.server.sendTransaction).toHaveBeenCalledWith(tx);
      expect(bravo.server.sendTransaction).toHaveBeenCalledWith(tx);
    });

    it("returns DUPLICATE as a successful outcome rather than retrying", async () => {
      alpha.server.sendTransaction = jest
        .fn()
        .mockResolvedValue({ status: "DUPLICATE", hash: "abc" });
      bravo.server.sendTransaction = jest.fn();

      const result = await client.call("sendTransaction", [{}]);

      expect(result).toEqual({ status: "DUPLICATE", hash: "abc" });
      expect(bravo.server.sendTransaction).not.toHaveBeenCalled();
    });

    it("retries TRY_AGAIN_LATER on another endpoint — the node is congested, not the tx bad", async () => {
      alpha.server.sendTransaction = jest
        .fn()
        .mockResolvedValue({ status: "TRY_AGAIN_LATER" });
      bravo.server.sendTransaction = jest
        .fn()
        .mockResolvedValue({ status: "PENDING", hash: "abc" });

      const result = await client.call("sendTransaction", [{}]);

      expect(result).toMatchObject({ status: "PENDING" });
      expect(bravo.server.sendTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("endpoint affinity", () => {
    it("polls status against the endpoint that accepted the submission", async () => {
      // Primary fails, so the submission lands on bravo.
      alpha.server.sendTransaction = jest
        .fn()
        .mockRejectedValue(new Error("down"));
      bravo.server.sendTransaction = jest
        .fn()
        .mockResolvedValue({ status: "PENDING", hash: "tx-hash-1" });

      await client.call("sendTransaction", [{}]);

      alpha.server.getTransaction = jest
        .fn()
        .mockResolvedValue({ status: "NOT_FOUND" });
      bravo.server.getTransaction = jest
        .fn()
        .mockResolvedValue({ status: "SUCCESS" });

      const status = await client.call("getTransaction", ["tx-hash-1"]);

      // Without affinity this would hit alpha first and report a phantom
      // NOT_FOUND for a transaction that was actually accepted.
      expect(bravo.server.getTransaction).toHaveBeenCalledWith("tx-hash-1");
      expect(alpha.server.getTransaction).not.toHaveBeenCalled();
      expect(status).toEqual({ status: "SUCCESS" });
    });

    it("returns NOT_FOUND from the pinned endpoint without falling over", async () => {
      alpha.server.sendTransaction = jest
        .fn()
        .mockResolvedValue({ status: "PENDING", hash: "tx-hash-2" });
      await client.call("sendTransaction", [{}]);

      alpha.server.getTransaction = jest
        .fn()
        .mockResolvedValue({ status: "NOT_FOUND" });
      bravo.server.getTransaction = jest.fn();

      const status = await client.call("getTransaction", ["tx-hash-2"]);

      // NOT_FOUND is a valid answer, not a transport failure.
      expect(status).toEqual({ status: "NOT_FOUND" });
      expect(bravo.server.getTransaction).not.toHaveBeenCalled();
    });

    it("falls back to the rest of the pool when the pinned endpoint errors", async () => {
      alpha.server.sendTransaction = jest
        .fn()
        .mockResolvedValue({ status: "PENDING", hash: "tx-hash-3" });
      await client.call("sendTransaction", [{}]);

      alpha.server.getTransaction = jest
        .fn()
        .mockRejectedValue(new Error("endpoint died"));
      bravo.server.getTransaction = jest
        .fn()
        .mockResolvedValue({ status: "SUCCESS" });

      await expect(
        client.call("getTransaction", ["tx-hash-3"])
      ).resolves.toEqual({ status: "SUCCESS" });
    });

    it("uses normal priority order for a hash it never submitted", async () => {
      alpha.server.getTransaction = jest
        .fn()
        .mockResolvedValue({ status: "SUCCESS" });

      await client.call("getTransaction", ["unknown-hash"]);

      expect(alpha.server.getTransaction).toHaveBeenCalledWith("unknown-hash");
    });
  });

  describe("unknown methods", () => {
    it("surfaces a clear error when rpc.Server has no such method", async () => {
      await expect(client.call("notAMethod", [])).rejects.toThrow(
        RpcPoolExhaustedError
      );
    });
  });
});
