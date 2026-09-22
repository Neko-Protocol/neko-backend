import { Test } from "@nestjs/testing";

jest.mock("@neko-protocol/keeper", () => ({
  StellarPriceService: jest.fn(),
  getAssetsConfig: jest.fn().mockReturnValue({}),
  getCurrentNetworkId: jest.fn().mockReturnValue("mainnet"),
}));

import { AssetPricesController } from "./asset-prices.controller";
import { AssetPricesService } from "./asset-prices.service";

describe("AssetPricesController", () => {
  it("delegates POST run-now to the service", async () => {
    const svc = { recordOnce: jest.fn().mockResolvedValue({ inserted: 5 }) };
    const mod = await Test.createTestingModule({
      controllers: [AssetPricesController],
      providers: [{ provide: AssetPricesService, useValue: svc }],
    }).compile();

    const out = await mod.get(AssetPricesController).runNow();
    expect(out).toEqual({ inserted: 5 });
    expect(svc.recordOnce).toHaveBeenCalledTimes(1);
  });
});
