import { RedisCacheService } from "../../../../core/cache/redis-cache.service";
import { DashboardCache } from "./dashboard-cache";

/**
 * A stand-in for the shared Redis store. `enabled` flips between the shared
 * path and the per-process fallback, which is the behaviour that matters here.
 */
function makeStore(enabled: boolean) {
  const entries = new Map<string, unknown>();
  const store = {
    isEnabled: () => enabled,
    through: jest.fn(
      async (key: string, _ttl: number, fetch: () => Promise<unknown>) => {
        if (entries.has(key)) return { value: entries.get(key), hit: true };
        const value = await fetch();
        entries.set(key, value);
        return { value, hit: false };
      }
    ),
    invalidate: jest.fn(async (key: string) => {
      entries.delete(key);
    }),
  };
  return { store: store as unknown as RedisCacheService, entries, spy: store };
}

describe("DashboardCache", () => {
  describe("with Redis available", () => {
    it("serves a second read from the shared store", async () => {
      const { store } = makeStore(true);
      const cache = new DashboardCache(store);
      const fetcher = jest.fn().mockResolvedValue("value");

      const first = await cache.getOrFetch("k", 1_000, fetcher);
      const second = await cache.getOrFetch("k", 1_000, fetcher);

      expect(first).toBe("value");
      expect(second).toBe("value");
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("namespaces keys so they cannot collide with other cached domains", async () => {
      const { store, entries } = makeStore(true);
      const cache = new DashboardCache(store);

      await cache.getOrFetch("positions:GABC", 1_000, async () => 1);

      expect([...entries.keys()]).toEqual(["dashboard:positions:GABC"]);
    });

    it("invalidate clears the shared entry", async () => {
      const { store } = makeStore(true);
      const cache = new DashboardCache(store);
      const fetcher = jest.fn().mockResolvedValue("v");

      await cache.getOrFetch("k", 1_000, fetcher);
      await cache.invalidate("k");
      await cache.getOrFetch("k", 1_000, fetcher);

      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe("falling back when Redis is unavailable", () => {
    let cache: DashboardCache;
    let spy: ReturnType<typeof makeStore>["spy"];

    beforeEach(() => {
      const made = makeStore(false);
      spy = made.spy;
      cache = new DashboardCache(made.store);
    });

    it("caches in-process instead of failing", async () => {
      const fetcher = jest.fn().mockResolvedValue("value");

      await cache.getOrFetch("k", 1_000, fetcher);
      const second = await cache.getOrFetch("k", 1_000, fetcher);

      expect(second).toBe("value");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(spy.through).not.toHaveBeenCalled();
    });

    it("refetches once the local entry expires", async () => {
      jest.useFakeTimers({ doNotFake: ["nextTick"] });
      jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const fetcher = jest.fn().mockResolvedValue("value");

      await cache.getOrFetch("k", 1_000, fetcher);
      jest.advanceTimersByTime(1_001);
      await cache.getOrFetch("k", 1_000, fetcher);

      expect(fetcher).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });

    it("collapses concurrent misses into one fetch", async () => {
      let resolve: (v: string) => void = () => {};
      const fetcher = jest.fn(
        () =>
          new Promise<string>((r) => {
            resolve = r;
          })
      );

      const all = Promise.all([
        cache.getOrFetch("k", 1_000, fetcher),
        cache.getOrFetch("k", 1_000, fetcher),
        cache.getOrFetch("k", 1_000, fetcher),
      ]);
      resolve("value");

      expect(await all).toEqual(["value", "value", "value"]);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("does not cache a rejected fetch", async () => {
      const fetcher = jest
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce("recovered");

      await expect(cache.getOrFetch("k", 1_000, fetcher)).rejects.toThrow(
        "boom"
      );
      await expect(cache.getOrFetch("k", 1_000, fetcher)).resolves.toBe(
        "recovered"
      );
    });

    it("clear empties the local store", async () => {
      await cache.getOrFetch("k", 1_000, async () => "v");
      expect(cache.size()).toBe(1);

      cache.clear();

      expect(cache.size()).toBe(0);
    });
  });
});
