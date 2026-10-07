// @blend-capital/blend-sdk bundles a @stellar/stellar-sdk whose CommonJS build
// requires ESM-only files. Node 24 can load them, Jest cannot. Nothing in this
// suite exercises Blend, so it is replaced before anything imports it.
jest.mock("@blend-capital/blend-sdk", () => ({
  PoolV2: { load: jest.fn() },
  Backstop: { load: jest.fn() },
}));

import { Test } from "@nestjs/testing";
import { PoolRatesController } from "./pool-rates.controller";
import { PoolRatesService } from "./pool-rates.service";

describe("PoolRatesController", () => {
  async function buildModule(svcOverrides: Partial<PoolRatesService>) {
    const mod = await Test.createTestingModule({
      controllers: [PoolRatesController],
      providers: [{ provide: PoolRatesService, useValue: svcOverrides }],
    }).compile();
    return mod.get(PoolRatesController);
  }

  it("GET /:poolId delegates to getHistory", async () => {
    const rows = [
      { supply_apy: 4.5, borrow_apy: 6.0, recorded_at: "2024-01-01T00:00:00Z" },
    ];
    const ctrl = await buildModule({
      getHistory: jest.fn().mockResolvedValue(rows),
    } as unknown as PoolRatesService);

    const result = await ctrl.getHistory({ poolId: "blend:pool1" });
    expect(result).toEqual(rows);
  });

  it("POST /record delegates to recordRates", async () => {
    const ctrl = await buildModule({
      recordRates: jest.fn().mockResolvedValue({ inserted: 3 }),
    } as unknown as PoolRatesService);

    const result = await ctrl.recordRates();
    expect(result).toEqual({ inserted: 3 });
  });
});
