import { Test } from "@nestjs/testing";
import { ConfigModule, ConfigService } from "@nestjs/config";

// AssetPricesService imports @neko/keeper (an ESM workspace package). Jest's
// CJS loader cannot parse it, so stub just the named exports we touch.
jest.mock("@neko/keeper", () => ({
  getCurrentNetworkId: jest.fn().mockReturnValue("mainnet"),
  getAssetsConfig: jest.fn().mockReturnValue({
    XLM: { code: "XLM", contract: "C_XLM_FAKE" },
    USDC: { code: "USDC", contract: "C_USDC_FAKE" },
  }),
}));

import { AssetPricesService } from "./asset-prices.service";
import { SupabaseService } from "@core/supabase/supabase.service";
import { RedisCacheService } from "@core/cache/redis-cache.service";
import { STELLAR_PRICE_SERVICE } from "./asset-prices.tokens";

/** RedisCacheService is @Global() in the app; test modules must provide it. */
function passThroughCache() {
  return {
    through: async (
      _key: string,
      _ttl: number,
      fetch: () => Promise<unknown>
    ) => ({
      value: await fetch(),
      hit: false,
    }),
  } as unknown as RedisCacheService;
}

describe("AssetPricesService", () => {
  function makeConfig() {
    return {
      get: jest.fn().mockReturnValue("mainnet"),
    };
  }

  it("inserts only rows with non-zero price", async () => {
    const insert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn().mockReturnValue({ insert });
    const supabase = { client: { from } } as unknown as SupabaseService;

    const priceService = {
      getPriceWithSource: jest
        .fn()
        .mockResolvedValue({ price: 1.23, source: "coingecko" }),
    };

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
        { provide: SupabaseService, useValue: supabase },
        { provide: RedisCacheService, useValue: passThroughCache() },
        { provide: STELLAR_PRICE_SERVICE, useValue: priceService },
      ],
    }).compile();

    const result = await mod.get(AssetPricesService).recordOnce();
    expect(result.inserted).toBeGreaterThan(0);
    expect(from).toHaveBeenCalledWith("asset_price_history");
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("returns inserted:0 when all prices are zero", async () => {
    const insert = jest.fn();
    const from = jest.fn().mockReturnValue({ insert });
    const supabase = { client: { from } } as unknown as SupabaseService;

    const priceService = {
      getPriceWithSource: jest
        .fn()
        .mockResolvedValue({ price: 0, source: null }),
    };

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
        { provide: SupabaseService, useValue: supabase },
        { provide: RedisCacheService, useValue: passThroughCache() },
        { provide: STELLAR_PRICE_SERVICE, useValue: priceService },
      ],
    }).compile();

    const result = await mod.get(AssetPricesService).recordOnce();
    expect(result.inserted).toBe(0);
    expect(insert).not.toHaveBeenCalled();
  });

  it("propagates Supabase errors", async () => {
    const insert = jest
      .fn()
      .mockResolvedValue({ error: { message: "db kaboom" } });
    const from = jest.fn().mockReturnValue({ insert });
    const supabase = { client: { from } } as unknown as SupabaseService;

    const priceService = {
      getPriceWithSource: jest
        .fn()
        .mockResolvedValue({ price: 1.23, source: "coingecko" }),
    };

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
        { provide: SupabaseService, useValue: supabase },
        { provide: RedisCacheService, useValue: passThroughCache() },
        { provide: STELLAR_PRICE_SERVICE, useValue: priceService },
      ],
    }).compile();

    await expect(
      mod.get(AssetPricesService).recordOnce()
    ).rejects.toMatchObject({ message: "db kaboom" });
  });

  describe("getHistory", () => {
    function buildService(
      rows: { price: number; source: string; recorded_at: string }[]
    ) {
      const limit = jest.fn().mockResolvedValue({ data: rows, error: null });
      const order = jest.fn().mockReturnValue({ limit });
      const gte = jest.fn().mockReturnValue({ order });
      const eq = jest.fn().mockReturnValue({ gte });
      const select = jest.fn().mockReturnValue({ eq });
      const from = jest.fn().mockReturnValue({ select });

      return {
        service: new AssetPricesService(
          makeConfig() as unknown as ConfigService,
          { client: { from } } as unknown as SupabaseService,
          {} as never, // cache — getHistory reads Supabase directly
          {} as never
        ),
        order,
        limit,
      };
    }

    it("requests newest rows with an explicit limit", async () => {
      const { service, order, limit } = buildService([]);

      await service.getHistory("xlm");

      expect(order).toHaveBeenCalledWith("recorded_at", { ascending: false });
      expect(limit).toHaveBeenCalledWith(10_000);
    });

    it("keeps the newest sample per hour and returns oldest first", async () => {
      const { service } = buildService([
        {
          price: 1.03,
          source: "coingecko",
          recorded_at: "2026-08-13T12:45:00.000Z",
        },
        {
          price: 1.02,
          source: "coingecko",
          recorded_at: "2026-08-13T12:15:00.000Z",
        },
        {
          price: 1.01,
          source: "coingecko",
          recorded_at: "2026-08-13T11:45:00.000Z",
        },
      ]);

      const result = await service.getHistory("XLM");

      expect(result.map((row) => row.price)).toEqual([1.01, 1.03]);
    });
  });
});
