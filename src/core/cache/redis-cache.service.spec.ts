import { ConfigService } from "@nestjs/config";
import { RedisCacheService } from "./redis-cache.service";

function makeStore(redisUrl?: string): RedisCacheService {
  const config = {
    get: (key: string) => (key === "REDIS_URL" ? redisUrl : undefined),
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

    it("propagates the fetcher's own error unchanged", async () => {
      // A cache miss must not mask a genuine upstream failure.
      await expect(
        store.through("k", 1_000, async () => {
          throw new Error("upstream exploded");
        })
      ).rejects.toThrow("upstream exploded");
    });
  });
});
