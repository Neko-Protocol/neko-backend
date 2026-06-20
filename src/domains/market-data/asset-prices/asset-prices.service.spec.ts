import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";

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
import { STELLAR_PRICE_SERVICE } from "./asset-prices.tokens";

describe("AssetPricesService", () => {
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
        { provide: STELLAR_PRICE_SERVICE, useValue: priceService },
      ],
    }).compile();

    await expect(
      mod.get(AssetPricesService).recordOnce()
    ).rejects.toMatchObject({ message: "db kaboom" });
  });
});
