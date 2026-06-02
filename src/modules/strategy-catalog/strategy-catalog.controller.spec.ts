import { Test } from "@nestjs/testing";
import { StrategyCatalogController } from "./strategy-catalog.controller";
import { StrategyCatalogService } from "./strategy-catalog.service";

describe("StrategyCatalogController", () => {
  it("delegates POST run-now to the service", async () => {
    const svc = { refresh: jest.fn().mockResolvedValue({ upserted: 4 }) };
    const mod = await Test.createTestingModule({
      controllers: [StrategyCatalogController],
      providers: [{ provide: StrategyCatalogService, useValue: svc }],
    }).compile();

    const out = await mod.get(StrategyCatalogController).runNow();
    expect(out).toEqual({ upserted: 4 });
    expect(svc.refresh).toHaveBeenCalledTimes(1);
  });
});
