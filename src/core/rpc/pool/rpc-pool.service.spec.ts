import { ConfigService } from "@nestjs/config";
import {
  BREAKER_COOLDOWN_MS,
  FAILURE_THRESHOLD,
  MAX_LEDGER_LAG,
  PoolEndpoint,
  RpcPoolService,
} from "./rpc-pool.service";

const POOL = JSON.stringify([
  { url: "https://a.example.com", label: "alpha", priority: 0 },
  { url: "https://b.example.com", label: "bravo", priority: 1 },
  { url: "https://c.example.com", label: "charlie", priority: 2 },
]);

function makePool(endpoints = POOL): RpcPoolService {
  const config = {
    get: (key: string) =>
      key === "STELLAR_RPC_ENDPOINTS" ? endpoints : undefined,
  } as unknown as ConfigService;

  const pool = new RpcPoolService(config);
  pool.onModuleInit();
  return pool;
}

function labels(endpoints: PoolEndpoint[]): string[] {
  return endpoints.map((e) => e.config.label);
}

function failUntilBreakerOpens(pool: RpcPoolService, endpoint: PoolEndpoint) {
  for (let i = 0; i < FAILURE_THRESHOLD; i += 1) {
    pool.recordFailure(endpoint, new Error("boom"));
  }
}

describe("RpcPoolService", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe("candidate ordering", () => {
    it("returns every endpoint in priority order when all are healthy", () => {
      const pool = makePool();

      expect(labels(pool.candidates())).toEqual(["alpha", "bravo", "charlie"]);
    });

    it("skips a downed endpoint so traffic fails over to the next priority", () => {
      const pool = makePool();
      failUntilBreakerOpens(pool, pool.byLabel("alpha")!);

      expect(labels(pool.candidates())).toEqual(["bravo", "charlie"]);
    });

    it("orders degraded endpoints after every healthy one", () => {
      const pool = makePool();
      const alpha = pool.byLabel("alpha")!;
      alpha.state = "degraded";

      // alpha has the best priority but is stale, so it must go last.
      expect(labels(pool.candidates())).toEqual(["bravo", "charlie", "alpha"]);
    });
  });

  describe("circuit breaker", () => {
    it("stays closed below the failure threshold", () => {
      const pool = makePool();
      const alpha = pool.byLabel("alpha")!;

      for (let i = 0; i < FAILURE_THRESHOLD - 1; i += 1) {
        pool.recordFailure(alpha, new Error("boom"));
      }

      expect(alpha.state).toBe("up");
    });

    it("opens at the failure threshold", () => {
      const pool = makePool();
      const alpha = pool.byLabel("alpha")!;

      failUntilBreakerOpens(pool, alpha);

      expect(alpha.state).toBe("down");
      expect(alpha.breakerOpenedAt).not.toBeNull();
    });

    it("keeps the endpoint out of rotation during the cooldown", () => {
      jest.useFakeTimers({ doNotFake: ["nextTick"] });
      jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));

      const pool = makePool();
      failUntilBreakerOpens(pool, pool.byLabel("alpha")!);

      jest.advanceTimersByTime(BREAKER_COOLDOWN_MS - 1);

      expect(labels(pool.candidates())).not.toContain("alpha");
    });

    it("allows a probe once the cooldown elapses, ranked last", () => {
      jest.useFakeTimers({ doNotFake: ["nextTick"] });
      jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));

      const pool = makePool();
      failUntilBreakerOpens(pool, pool.byLabel("alpha")!);

      jest.advanceTimersByTime(BREAKER_COOLDOWN_MS);

      expect(labels(pool.candidates())).toEqual(["bravo", "charlie", "alpha"]);
    });

    it("closes the breaker on a successful call", () => {
      const pool = makePool();
      const alpha = pool.byLabel("alpha")!;
      failUntilBreakerOpens(pool, alpha);

      pool.recordSuccess(alpha);

      expect(alpha.state).toBe("up");
      expect(alpha.consecutiveFailures).toBe(0);
      expect(alpha.breakerOpenedAt).toBeNull();
    });

    it("does not un-degrade a stale endpoint just because a call succeeded", () => {
      const pool = makePool();
      const alpha = pool.byLabel("alpha")!;
      alpha.state = "degraded";

      pool.recordSuccess(alpha);

      // Only a fresh ledger reading can clear staleness.
      expect(alpha.state).toBe("degraded");
    });
  });

  describe("stale ledger eviction", () => {
    it("degrades an endpoint lagging beyond the threshold", () => {
      const pool = makePool();

      pool.applyHealthResults([
        { endpoint: pool.byLabel("alpha")!, healthy: true, latestLedger: 100 },
        { endpoint: pool.byLabel("bravo")!, healthy: true, latestLedger: 200 },
        {
          endpoint: pool.byLabel("charlie")!,
          healthy: true,
          latestLedger: 200,
        },
      ]);

      expect(pool.byLabel("alpha")!.state).toBe("degraded");
      expect(pool.byLabel("alpha")!.ledgerLag).toBe(100);
      expect(pool.byLabel("bravo")!.state).toBe("up");
    });

    it("keeps an endpoint healthy when it lags within the threshold", () => {
      const pool = makePool();

      pool.applyHealthResults([
        {
          endpoint: pool.byLabel("alpha")!,
          healthy: true,
          latestLedger: 200 - MAX_LEDGER_LAG,
        },
        { endpoint: pool.byLabel("bravo")!, healthy: true, latestLedger: 200 },
        {
          endpoint: pool.byLabel("charlie")!,
          healthy: true,
          latestLedger: 200,
        },
      ]);

      expect(pool.byLabel("alpha")!.state).toBe("up");
    });

    it("puts a recovered endpoint back in rotation once it catches up", () => {
      const pool = makePool();
      const alpha = pool.byLabel("alpha")!;

      pool.applyHealthResults([
        { endpoint: alpha, healthy: true, latestLedger: 100 },
        { endpoint: pool.byLabel("bravo")!, healthy: true, latestLedger: 200 },
      ]);
      expect(alpha.state).toBe("degraded");

      pool.applyHealthResults([
        { endpoint: alpha, healthy: true, latestLedger: 201 },
        { endpoint: pool.byLabel("bravo")!, healthy: true, latestLedger: 201 },
      ]);

      expect(alpha.state).toBe("up");
      expect(labels(pool.candidates())[0]).toBe("alpha");
    });

    it("counts a failed probe as a failure", () => {
      const pool = makePool();
      const alpha = pool.byLabel("alpha")!;

      pool.applyHealthResults([
        {
          endpoint: alpha,
          healthy: false,
          latestLedger: null,
          error: new Error("unreachable"),
        },
      ]);

      expect(alpha.consecutiveFailures).toBe(1);
      expect(alpha.lastError).toBe("unreachable");
    });
  });

  describe("snapshot", () => {
    it("reports host without credentials and never the raw URL", () => {
      const pool = makePool(
        JSON.stringify([
          { url: "https://user:secret@a.example.com", label: "alpha" },
        ])
      );

      const [snapshot] = pool.snapshot();

      expect(snapshot.host).toBe("a.example.com");
      expect(JSON.stringify(snapshot)).not.toContain("secret");
    });

    it("hasUsableEndpoint is false only when every endpoint is down", () => {
      const pool = makePool();
      expect(pool.hasUsableEndpoint()).toBe(true);

      for (const endpoint of pool.all()) {
        failUntilBreakerOpens(pool, endpoint);
      }

      expect(pool.hasUsableEndpoint()).toBe(false);
    });
  });
});
