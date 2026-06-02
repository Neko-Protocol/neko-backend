import { DashboardCache } from "./dashboard-cache";

describe("DashboardCache", () => {
  let cache: DashboardCache;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    cache = new DashboardCache();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("set + get returns value within TTL", () => {
    cache.set("k", { foo: 1 }, 1000);
    expect(cache.get<{ foo: number }>("k")).toEqual({ foo: 1 });
  });

  it("get returns undefined after TTL expires", () => {
    cache.set("k", "value", 1000);
    jest.advanceTimersByTime(1001);
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("invalidate removes an entry", () => {
    cache.set("k", 42, 5000);
    cache.invalidate("k");
    expect(cache.get("k")).toBeUndefined();
  });

  it("getOrFetch calls fetcher on miss and caches result", async () => {
    const fetcher = jest.fn().mockResolvedValue("x");
    const first = await cache.getOrFetch("k", 1000, fetcher);
    const second = await cache.getOrFetch("k", 1000, fetcher);
    expect(first).toBe("x");
    expect(second).toBe("x");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("getOrFetch refetches after TTL expires", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce("a")
      .mockResolvedValueOnce("b");

    const first = await cache.getOrFetch("k", 1000, fetcher);
    jest.advanceTimersByTime(1001);
    const second = await cache.getOrFetch("k", 1000, fetcher);

    expect(first).toBe("a");
    expect(second).toBe("b");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("getOrFetch dedups inflight requests for the same key", async () => {
    let resolveFetch: (value: string) => void;
    const fetcher = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const p1 = cache.getOrFetch("k", 1000, fetcher);
    const p2 = cache.getOrFetch("k", 1000, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);

    resolveFetch!("result");
    const [a, b] = await Promise.all([p1, p2]);

    expect(a).toBe("result");
    expect(b).toBe("result");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("getOrFetch does not cache when the fetcher rejects", async () => {
    const fetcher = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok");

    await expect(cache.getOrFetch("k", 1000, fetcher)).rejects.toThrow("boom");
    const second = await cache.getOrFetch("k", 1000, fetcher);

    expect(second).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("clear empties cache and inflight map", async () => {
    cache.set("k1", 1, 1000);
    cache.set("k2", 2, 1000);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get("k1")).toBeUndefined();
  });
});
