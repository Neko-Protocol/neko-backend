import { ConfigService } from "@nestjs/config";

jest.mock("@neko/keeper", () => ({
  getCurrentNetworkId: jest.fn().mockReturnValue("mainnet"),
  getAssetsConfig: jest.fn().mockReturnValue({
    CETES: { contract: "C_CETES_FAKE", name: "Cetes" },
    USTRY: { contract: "C_USTRY_FAKE", name: "UsTry" },
    TESOURO: { contract: "C_TESOURO_FAKE", name: "Tesouro" },
  }),
}));
jest.mock("@neko/orchestrator", () => ({
  createOrchestrator: jest.fn(),
  setContractErrorExtractor: jest.fn(),
}));

import { StrategyCatalogService } from "./strategy-catalog.service";
import { SupabaseService } from "../supabase/supabase.service";
import { OrchestratorService } from "../orchestrator/orchestrator.service";
import { DefindexService } from "../defindex/defindex.service";

type AnyRecord = Record<string, unknown>;

function buildSupabaseMock(opts: {
  upsertError?: { message: string } | null;
  deleteError?: { message: string } | null;
}) {
  const upsert = jest
    .fn()
    .mockResolvedValue({ error: opts.upsertError ?? null });
  const lt = jest.fn().mockResolvedValue({ error: opts.deleteError ?? null });
  const inFn = jest.fn(() => ({ lt }));
  const del = jest.fn(() => ({ in: inFn }));
  const from = jest.fn(() => ({ upsert, delete: del }));
  return {
    service: { client: { from } } as unknown as SupabaseService,
    upsert,
    from,
  };
}

function buildService(
  supabase: SupabaseService,
  pools: AnyRecord[],
  vaults: AnyRecord[]
) {
  const config = {
    get: jest.fn().mockReturnValue("mainnet"),
  } as unknown as ConfigService;
  const orchestratorService = {
    orchestrator: { getAllPools: jest.fn().mockResolvedValue(pools) },
  } as unknown as OrchestratorService;
  const defindex = {
    getVaults: jest.fn().mockResolvedValue({ vaults, prices: {} }),
  } as unknown as DefindexService;
  return new StrategyCatalogService(
    config,
    supabase,
    orchestratorService,
    defindex
  );
}

describe("StrategyCatalogService", () => {
  const pool = {
    id: "p1",
    type: "blend",
    name: "Pool 1",
    apy: 5,
    tokens: [{ code: "USDC" }],
  };
  const vault = {
    contractId: "v1",
    info: { name: "Vault 1", assets: [{ symbol: "USDC" }] },
  };

  it("builds destinations and upserts them to the catalog", async () => {
    const { service: supabase, upsert } = buildSupabaseMock({});
    const svc = buildService(supabase, [pool], [vault]);

    const result = await svc.refresh();

    expect(result.upserted).toBeGreaterThanOrEqual(2);
    expect(upsert).toHaveBeenCalledTimes(1);
    const rows = upsert.mock.calls[0][0] as AnyRecord[];
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "pool", id: "p1", protocol: "Blend" }),
        expect.objectContaining({
          kind: "vault",
          id: "v1",
          accepted_token_codes: ["USDC"],
        }),
      ])
    );
  });

  it("throws when the upsert fails", async () => {
    const { service: supabase } = buildSupabaseMock({
      upsertError: { message: "boom" },
    });
    const svc = buildService(supabase, [pool], [vault]);
    await expect(svc.refresh()).rejects.toThrow(/boom/);
  });
});
