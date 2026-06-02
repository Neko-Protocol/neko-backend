import { Test } from "@nestjs/testing";

// PoolRatesService transitively imports OrchestratorService, which imports
// @neko/orchestrator (an ESM workspace package). Stub it so Jest's CJS loader
// does not try to parse the ESM build — we only need the service contract.
jest.mock("@neko/orchestrator", () => ({
  createOrchestrator: jest.fn(),
  setContractErrorExtractor: jest.fn(),
}));

import { PoolRatesService } from "./pool-rates.service";
import { OrchestratorService } from "../orchestrator/orchestrator.service";
import { SupabaseService } from "../supabase/supabase.service";

describe("PoolRatesService", () => {
  it("inserts only pools with non-zero APY", async () => {
    const insert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn().mockReturnValue({ insert });
    const supabase = {
      client: { from },
    } as unknown as SupabaseService;
    const orchestrator = {
      orchestrator: {
        getAllPools: jest.fn().mockResolvedValue([
          { id: "blend:p:a", apy: 4.5, metadata: { borrowApy: 6.0 } },
          { id: "soroswap:x", apy: 0, metadata: {} },
          { id: "aqua:y", apy: 0, metadata: { borrowApy: 0 } },
        ]),
      },
    } as unknown as OrchestratorService;

    const mod = await Test.createTestingModule({
      providers: [
        PoolRatesService,
        { provide: OrchestratorService, useValue: orchestrator },
        { provide: SupabaseService, useValue: supabase },
      ],
    }).compile();

    const result = await mod.get(PoolRatesService).recordOnce();
    expect(result.inserted).toBe(1);
    expect(from).toHaveBeenCalledWith("pool_rate_history");
    expect(insert).toHaveBeenCalledWith([
      { pool_id: "blend:p:a", supply_apy: 4.5, borrow_apy: 6.0 },
    ]);
  });

  it("returns inserted:0 when nothing matches", async () => {
    const insert = jest.fn();
    const supabase = {
      client: { from: jest.fn().mockReturnValue({ insert }) },
    } as unknown as SupabaseService;
    const orchestrator = {
      orchestrator: { getAllPools: jest.fn().mockResolvedValue([]) },
    } as unknown as OrchestratorService;

    const mod = await Test.createTestingModule({
      providers: [
        PoolRatesService,
        { provide: OrchestratorService, useValue: orchestrator },
        { provide: SupabaseService, useValue: supabase },
      ],
    }).compile();

    expect((await mod.get(PoolRatesService).recordOnce()).inserted).toBe(0);
    expect(insert).not.toHaveBeenCalled();
  });

  it("propagates Supabase errors", async () => {
    const insert = jest
      .fn()
      .mockResolvedValue({ error: { message: "db kaboom" } });
    const supabase = {
      client: { from: jest.fn().mockReturnValue({ insert }) },
    } as unknown as SupabaseService;
    const orchestrator = {
      orchestrator: {
        getAllPools: jest
          .fn()
          .mockResolvedValue([
            { id: "blend:p:a", apy: 4.5, metadata: { borrowApy: 6.0 } },
          ]),
      },
    } as unknown as OrchestratorService;

    const mod = await Test.createTestingModule({
      providers: [
        PoolRatesService,
        { provide: OrchestratorService, useValue: orchestrator },
        { provide: SupabaseService, useValue: supabase },
      ],
    }).compile();

    await expect(mod.get(PoolRatesService).recordOnce()).rejects.toMatchObject({
      message: "db kaboom",
    });
  });
});
