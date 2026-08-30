import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisCacheService } from "./redis-cache.service";

function makeStore(
  redisUrl?: string,
  extra: Record<string, string> = {}
): RedisCacheService {
  const config = {
    get: (key: string) =>
      key === "REDIS_URL" ? redisUrl : (extra[key] as string | undefined),
  } as unknown as ConfigService;
  return new RedisCacheService(config);
}

describe("RedisCacheService", () => {
  describe("without REDIS_URL", () => {
    let store: RedisCacheService;

    beforeEach(() => {
      store = makeStore();
      store.onModuleInit();
    });

    it("reports itself disabled instead of failing to boot", () => {
      expect(store.isEnabled()).toBe(false);
    });

    it("still runs the fetcher and reports a miss", async () => {
      const fetch = jest.fn().mockResolvedValue({ sequence: 1 });

      const result = await store.through("k", 1_000, fetch);

      expect(result).toEqual({ value: { sequence: 1 }, hit: false });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("runs the fetcher every time, since nothing is stored", async () => {
      const fetch = jest.fn().mockResolvedValue("v");

      await store.through("k", 1_000, fetch);
      await store.through("k", 1_000, fetch);

      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("invalidate is a no-op rather than an error", async () => {
      await expect(store.invalidate("k")).resolves.toBeUndefined();
    });
  });

  describe("when Redis is unreachable", () => {
    let store: RedisCacheService;

    beforeEach(() => {
      // Port 1 is reserved and never listening.
      store = makeStore("redis://127.0.0.1:1");
      store.onModuleInit();
    });

    afterEach(async () => {
      await store.onModuleDestroy();
    });

    it("fails open — the caller still gets its value", async () => {
      const fetch = jest.fn().mockResolvedValue("upstream");

      const result = await store.through("k", 1_000, fetch);

      expect(result.value).toBe("upstream");
      expect(result.hit).toBe(false);
      expect(fetch).toHaveBeenCalled();
    });

    it("never surfaces a Redis error to the caller", async () => {
      await expect(
        store.through("k", 1_000, async () => "ok")
      ).resolves.toMatchObject({ value: "ok" });
    });

    it("warns loudly when a configured Redis never connects", async () => {
      // Silent degradation is the failure mode this guards against: the app
      // looks healthy while every read goes upstream.
      jest.useFakeTimers({ doNotFake: ["nextTick"] });
      const other = makeStore("redis://127.0.0.1:1");
      const spy = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);

      other.onModuleInit();
      jest.advanceTimersByTime(10_000);

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("REDIS_URL is configured")
      );

      spy.mockRestore();
      jest.useRealTimers();
      await other.onModuleDestroy();
    });

    it("propagates the fetcher's own error unchanged", async () => {
      // A cache miss must not mask a genuine upstream failure.
      await expect(
        store.through("k", 1_000, async () => {
          throw new Error("upstream exploded");
        })
      ).rejects.toThrow("upstream exploded");
    });
  });

  describe("reporting", () => {
    const opened: RedisCacheService[] = [];

    // onModuleInit arms a timer that warns if a configured Redis never
    // connects. Left running, it keeps the test process alive.
    afterEach(async () => {
      await Promise.all(opened.splice(0).map((s) => s.onModuleDestroy()));
    });

    it("resolves both A and AAAA records by default", () => {
      // Railway's private network publishes IPv6 only, and ioredis looks up
      // IPv4 alone unless told otherwise — so a healthy Redis at
      // *.railway.internal never resolves. The cache is fail-open, so this
      // surfaces as every read being a miss and nothing else: it ran that way
      // in two deployed environments before anyone noticed.
      const store = makeStore("redis://127.0.0.1:1");
      store.onModuleInit();
      opened.push(store);

      const options = (
        store as unknown as { client: { options: { family?: number } } }
      ).client.options;

      expect(options.family).toBe(0);
    });

    it("honours REDIS_FAMILY when dual-stack needs overriding", () => {
      const store = makeStore("redis://127.0.0.1:1", { REDIS_FAMILY: "6" });
      store.onModuleInit();
      opened.push(store);

      const options = (
        store as unknown as { client: { options: { family?: number } } }
      ).client.options;

      expect(options.family).toBe(6);
    });

    it("starts with clean operation counters", () => {
      const store = makeStore();
      store.onModuleInit();
      opened.push(store);

      expect(store.getStats()).toEqual({
        reads: 0,
        writes: 0,
        timeouts: 0,
        errors: 0,
      });
    });

    it("counts a timed-out operation apart from a miss", async () => {
      // A miss and a timeout look identical to the caller, which is why a
      // cache that answers nothing in time can pass for a cold one. The
      // counters are what tell them apart.
      const store = makeStore("redis://127.0.0.1:1", {
        REDIS_OP_TIMEOUT_MS: "5",
      });
      store.onModuleInit();
      // onModuleInit opened a real client against a dead port; it would keep
      // retrying past the end of the test if it were only overwritten.
      const real = (store as unknown as { client: { disconnect(): void } })
        .client;
      real.disconnect();
      (store as unknown as { connected: boolean }).connected = true;
      // Resolves, but later than the operation timeout — a slow Redis, not a
      // hanging one, so nothing is left pending when the test ends.
      const slow = () =>
        new Promise((resolve) => setTimeout(() => resolve(null), 60));
      (store as unknown as { client: unknown }).client = {
        get: slow,
        set: slow,
        quit: async () => "OK",
      };

      const { value, hit } = await store.through("k", 1_000, async () => "v");

      expect(value).toBe("v");
      expect(hit).toBe(false);
      expect(store.getStats().timeouts).toBeGreaterThan(0);

      await store.onModuleDestroy();
    });
  });
});
