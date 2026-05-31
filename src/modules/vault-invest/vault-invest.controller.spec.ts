import { Test } from "@nestjs/testing";

jest.mock("@neko/keeper", () => ({
  planVaultRebalance: jest.fn(),
  getConfiguredRebalanceVaultIds: jest.fn().mockReturnValue([]),
  getVaultRebalanceConfig: jest.fn(),
  parseAllVaultIds: jest.fn().mockReturnValue([]),
  resolveVaultIdForApi: jest.fn(),
}));

import { VaultInvestController } from "./vault-invest.controller";
import { VaultInvestService } from "./vault-invest.service";

describe("VaultInvestController", () => {
  it("delegates to runBatch when no vault is supplied", async () => {
    const svc = {
      runBatch: jest
        .fn()
        .mockResolvedValue({ success: true, mode: "batch", vaults: [] }),
      runSingle: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      controllers: [VaultInvestController],
      providers: [{ provide: VaultInvestService, useValue: svc }],
    }).compile();

    const out = await mod.get(VaultInvestController).runNow();
    expect(svc.runBatch).toHaveBeenCalledWith("manual");
    expect(svc.runSingle).not.toHaveBeenCalled();
    expect(out.mode).toBe("batch");
  });

  it("delegates to runSingle when a vault query param is supplied", async () => {
    const svc = {
      runBatch: jest.fn(),
      runSingle: jest.fn().mockResolvedValue({
        success: true,
        mode: "single",
        vaults: [],
        invested: false,
        results: [],
        idleAmount: 0,
      }),
    };
    const mod = await Test.createTestingModule({
      controllers: [VaultInvestController],
      providers: [{ provide: VaultInvestService, useValue: svc }],
    }).compile();

    await mod.get(VaultInvestController).runNow("CXYZ");
    expect(svc.runSingle).toHaveBeenCalledWith("CXYZ", "manual");
    expect(svc.runBatch).not.toHaveBeenCalled();
  });

  it("trims whitespace and falls back to batch when vault param is empty", async () => {
    const svc = {
      runBatch: jest
        .fn()
        .mockResolvedValue({ success: true, mode: "batch", vaults: [] }),
      runSingle: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      controllers: [VaultInvestController],
      providers: [{ provide: VaultInvestService, useValue: svc }],
    }).compile();

    await mod.get(VaultInvestController).runNow("   ");
    expect(svc.runBatch).toHaveBeenCalledWith("manual");
    expect(svc.runSingle).not.toHaveBeenCalled();
  });
});
