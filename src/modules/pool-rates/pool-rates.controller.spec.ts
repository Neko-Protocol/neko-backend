import { Test } from "@nestjs/testing";

jest.mock("@neko/orchestrator", () => ({
  createOrchestrator: jest.fn(),
  setContractErrorExtractor: jest.fn(),
}));

import { PoolRatesController } from "./pool-rates.controller";
import { PoolRatesService } from "./pool-rates.service";

describe("PoolRatesController", () => {
  it("delegates POST run-now to the service", async () => {
    const svc = { recordOnce: jest.fn().mockResolvedValue({ inserted: 3 }) };
    const mod = await Test.createTestingModule({
      controllers: [PoolRatesController],
      providers: [{ provide: PoolRatesService, useValue: svc }],
    }).compile();

    const out = await mod.get(PoolRatesController).runNow();
    expect(out).toEqual({ inserted: 3 });
    expect(svc.recordOnce).toHaveBeenCalledTimes(1);
  });
});
