import { Test } from "@nestjs/testing";
import { InternalServerErrorException } from "@nestjs/common";
import { PoolRatesService } from "./pool-rates.service";
import { StellarRpcService } from "../stellar/stellar-rpc.service";
import { SupabaseService } from "../supabase/supabase.service";

jest.mock("./adapters/blend-pool.adapter");
jest.mock("./adapters/aqua-pool.adapter");

import { BlendPoolAdapter } from "./adapters/blend-pool.adapter";
import { AquaPoolAdapter } from "./adapters/aqua-pool.adapter";

const mockStellar = {
  getSafeRpcUrl: jest.fn().mockReturnValue("https://rpc.example.com"),
  getNetworkPassphrase: jest.fn().mockReturnValue("Test SDF Network ; September 2015"),
  getNetwork: jest.fn().mockReturnValue("testnet"),
} as unknown as StellarRpcService;

function makeSupabase(overrides: {
  selectData?: object[];
  selectError?: object | null;
  insertError?: object | null;
}) {
  const { selectData = [], selectError = null, insertError = null } = overrides;
  const insert = jest.fn().mockResolvedValue({ error: insertError });
  const order = jest.fn().mockResolvedValue({ data: selectData, error: selectError });
  const gte = jest.fn().mockReturnValue({ order });
  const eq = jest.fn().mockReturnValue({ gte });
  const select = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ select, insert });
  return { client: { from }, _insert: insert } as unknown as SupabaseService & {
    _insert: jest.Mock;
  };
}

async function buildModule(supabase: SupabaseService) {
  const mod = await Test.createTestingModule({
    providers: [
      PoolRatesService,
      { provide: StellarRpcService, useValue: mockStellar },
      { provide: SupabaseService, useValue: supabase },
    ],
  }).compile();
  return mod.get(PoolRatesService);
}

describe("PoolRatesService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getHistory", () => {
    it("returns rate history for a pool", async () => {
      const rows = [
        { supply_apy: 4.5, borrow_apy: 6.0, recorded_at: "2024-01-01T00:00:00Z" },
      ];
      const svc = await buildModule(makeSupabase({ selectData: rows }));
      const result = await svc.getHistory("blend:pool1");
      expect(result).toEqual(rows);
    });

    it("throws InternalServerErrorException on Supabase error", async () => {
      const svc = await buildModule(
        makeSupabase({ selectError: { message: "db error" } })
      );
      await expect(svc.getHistory("blend:pool1")).rejects.toBeInstanceOf(
        InternalServerErrorException
      );
    });
  });

  describe("recordRates", () => {
    it("inserts rows from blend and aqua adapters", async () => {
      const blendRows = [{ pool_id: "blend:p1", supply_apy: 4.5, borrow_apy: 6.0 }];
      const aquaRows = [{ pool_id: "aqua:p1", supply_apy: 2.1, borrow_apy: null }];
      (BlendPoolAdapter as jest.MockedClass<typeof BlendPoolAdapter>).prototype.fetchRates =
        jest.fn().mockResolvedValue(blendRows);
      (AquaPoolAdapter as jest.MockedClass<typeof AquaPoolAdapter>).prototype.fetchRates =
        jest.fn().mockResolvedValue(aquaRows);

      const supabase = makeSupabase({});
      const svc = await buildModule(supabase);
      const result = await svc.recordRates();

      expect(result.inserted).toBe(2);
      expect(supabase._insert).toHaveBeenCalledWith([...blendRows, ...aquaRows]);
    });

    it("returns inserted:0 when all adapters return zero-APY pools", async () => {
      (BlendPoolAdapter as jest.MockedClass<typeof BlendPoolAdapter>).prototype.fetchRates =
        jest.fn().mockResolvedValue([{ pool_id: "x", supply_apy: 0, borrow_apy: 0 }]);
      (AquaPoolAdapter as jest.MockedClass<typeof AquaPoolAdapter>).prototype.fetchRates =
        jest.fn().mockResolvedValue([]);

      const supabase = makeSupabase({});
      const svc = await buildModule(supabase);
      const result = await svc.recordRates();

      expect(result.inserted).toBe(0);
      expect(supabase._insert).not.toHaveBeenCalled();
    });

    it("throws InternalServerErrorException on Supabase insert error", async () => {
      (BlendPoolAdapter as jest.MockedClass<typeof BlendPoolAdapter>).prototype.fetchRates =
        jest.fn().mockResolvedValue([{ pool_id: "x", supply_apy: 5, borrow_apy: null }]);
      (AquaPoolAdapter as jest.MockedClass<typeof AquaPoolAdapter>).prototype.fetchRates =
        jest.fn().mockResolvedValue([]);

      const svc = await buildModule(makeSupabase({ insertError: { message: "fail" } }));
      await expect(svc.recordRates()).rejects.toBeInstanceOf(
        InternalServerErrorException
      );
    });
  });
});
