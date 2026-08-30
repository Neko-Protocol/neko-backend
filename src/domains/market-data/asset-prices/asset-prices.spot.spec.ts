import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";

// AssetPricesService imports @neko/keeper (an ESM workspace package). Jest's
// CJS loader cannot parse it, so stub just the named exports we touch.
jest.mock("@neko/keeper", () => ({
  getCurrentNetworkId: jest.fn().mockReturnValue("mainnet"),
  getAssetsConfig: jest.fn().mockReturnValue({
    XLM: { code: "XLM", contract: "C_XLM_FAKE" },
    GYEN: { code: "GYEN", contract: "C_GYEN_FAKE" },
  }),
}));

import { AssetPricesService } from "./asset-prices.service";
import { SupabaseService } from "@core/supabase/supabase.service";
import { RedisCacheService } from "@core/cache/redis-cache.service";
import { STELLAR_PRICE_SERVICE } from "./asset-prices.tokens";

/** Stands in for Redis: same contract, and observable from the test. */
function makeCache(enabled = true) {
  const store = new Map<string, unknown>();
  const through = jest.fn(
    async (key: string, _ttl: number, fetch: () => Promise<unknown>) => {
      if (!enabled) return { value: await fetch(), hit: false };
      if (store.has(key)) return { value: store.get(key), hit: true };
      const value = await fetch();
      store.set(key, value);
      return { value, hit: false };
    }
  );
  return {
    service: { through } as unknown as RedisCacheService,
    through,
    store,
  };
}

async function build(priceService: unknown, cache: RedisCacheService) {
  const mod = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => ({ STELLAR_NETWORK: "mainnet" })],
      }),
    ],
    providers: [
      AssetPricesService,
      { provide: SupabaseService, useValue: { client: {} } },
      { provide: RedisCacheService, useValue: cache },
      { provide: STELLAR_PRICE_SERVICE, useValue: priceService },
    ],
  }).compile();
  return mod.get(AssetPricesService);
}

describe("AssetPricesService.getSpotPrices", () => {
  it("returns a price per requested symbol", async () => {
    const priceService = {
      getPriceWithSource: jest
        .fn()
        .mockResolvedValue({ price: 0.18, source: "reflector" }),
    };
    const cache = makeCache();

    const result = await (
      await build(priceService, cache.service)
    ).getSpotPrices(["XLM", "GYEN"]);

    expect(result).toEqual({
      XLM: { price: 0.18, source: "reflector" },
      GYEN: { price: 0.18, source: "reflector" },
    });
  });

  it("serves a repeat request from cache without going upstream", async () => {
    const priceService = {
      getPriceWithSource: jest
        .fn()
        .mockResolvedValue({ price: 1, source: "coingecko" }),
    };
    const cache = makeCache();
    const svc = await build(priceService, cache.service);

    await svc.getSpotPrices(["XLM"]);
    await svc.getSpotPrices(["XLM"]);

    // The point of the whole change: the second page load costs nothing
    // upstream, which is what stops CoinGecko rate-limiting us.
    expect(priceService.getPriceWithSource).toHaveBeenCalledTimes(1);
  });

  it("caches a zero price, so a rate-limited source is not retried per request", async () => {
    // CoinGecko answering 429 surfaces as price 0 — the chain swallows it.
    const priceService = {
      getPriceWithSource: jest
        .fn()
        .mockResolvedValue({ price: 0, source: null }),
    };
    const cache = makeCache();
    const svc = await build(priceService, cache.service);

    await svc.getSpotPrices(["GYEN"]);
    const second = await svc.getSpotPrices(["GYEN"]);

    expect(priceService.getPriceWithSource).toHaveBeenCalledTimes(1);
    expect(second.GYEN).toEqual({ price: 0, source: null });
  });

  it("still resolves prices when Redis is down", async () => {
    const priceService = {
      getPriceWithSource: jest
        .fn()
        .mockResolvedValue({ price: 2.5, source: "reflector" }),
    };
    const cache = makeCache(false); // fail-open: every call reaches upstream
    const svc = await build(priceService, cache.service);

    const result = await svc.getSpotPrices(["XLM"]);

    expect(result.XLM).toEqual({ price: 2.5, source: "reflector" });
  });

  it("reports an unknown symbol as unpriced instead of failing the batch", async () => {
    const priceService = {
      getPriceWithSource: jest
        .fn()
        .mockResolvedValue({ price: 0.18, source: "reflector" }),
    };
    const svc = await build(priceService, makeCache().service);

    const result = await svc.getSpotPrices(["XLM", "NOPE"]);

    expect(result.XLM.price).toBe(0.18);
    expect(result.NOPE).toEqual({ price: 0, source: null });
    expect(priceService.getPriceWithSource).toHaveBeenCalledTimes(1);
  });

  it("keeps the rest of the batch when one symbol throws", async () => {
    const priceService = {
      getPriceWithSource: jest.fn().mockImplementation(async (code: string) => {
        if (code === "GYEN") throw new Error("upstream exploded");
        return { price: 0.18, source: "reflector" };
      }),
    };
    const svc = await build(priceService, makeCache().service);

    const result = await svc.getSpotPrices(["XLM", "GYEN"]);

    expect(result.XLM.price).toBe(0.18);
    expect(result.GYEN).toEqual({ price: 0, source: null });
  });
});
