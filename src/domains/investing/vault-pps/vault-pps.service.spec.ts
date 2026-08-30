import { Test } from "@nestjs/testing";

jest.mock("@neko/keeper", () => ({
  parseAllVaultIds: jest.fn(),
}));

jest.mock("@neko/defindex-vault", () => ({
  Client: jest.fn(),
}));

jest.mock("../vault-invest/keeper/tx", () => ({
  fetchManagedFunds: jest.fn(),
}));

import { ConfigService } from "@nestjs/config";
import { fetchManagedFunds } from "../vault-invest/keeper/tx";
import { VaultPpsService } from "./vault-pps.service";
import { SupabaseService } from "@core/supabase/supabase.service";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";

const { Client: ClientMock } = jest.requireMock("@neko/defindex-vault") as {
  Client: jest.Mock;
};
const { parseAllVaultIds: parseAllVaultIdsMock } = jest.requireMock(
  "@neko/keeper"
) as { parseAllVaultIds: jest.Mock };
const fetchManagedFundsMock = fetchManagedFunds as unknown as jest.Mock;

describe("VaultPpsService", () => {
  beforeEach(() => {
    ClientMock.mockReset();
    parseAllVaultIdsMock.mockReset();
    fetchManagedFundsMock.mockReset();
  });

  it("inserts rows with non-zero PPS for each vault", async () => {
    parseAllVaultIdsMock.mockReturnValue(["VAULT_A"]);
    ClientMock.mockImplementation(() => ({
      total_supply: jest.fn().mockResolvedValue({ result: "1000000" }),
    }));
    fetchManagedFundsMock.mockResolvedValue([{ total_amount: 2_000_000n }]);

    const insert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn().mockReturnValue({ insert });
    const supabase = {
      client: { from },
    } as unknown as SupabaseService;
    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (key === "STELLAR_RPC_URL") return "https://rpc.test";
        if (key === "STELLAR_NETWORK_PASSPHRASE") return "Test SDF Network";
        throw new Error(`missing ${key}`);
      }),
    } as unknown as ConfigService;

    const mod = await Test.createTestingModule({
      providers: [
        VaultPpsService,
        { provide: ConfigService, useValue: config },
        { provide: SupabaseService, useValue: supabase },
        // The vault client is mocked, so the pool proxy is never called —
        // it only has to be resolvable.
        { provide: StellarRpcService, useValue: { rpc: {} } },
      ],
    }).compile();

    const result = await mod.get(VaultPpsService).recordOnce();
    expect(result.inserted).toBe(1);
    expect(from).toHaveBeenCalledWith("vault_pps_history");
    expect(insert).toHaveBeenCalledWith([
      { vault_id: "VAULT_A", pps: "2000000000000" },
    ]);
  });

  describe("getHistory", () => {
    function buildService(rows: { pps: string; recorded_at: string }[]) {
      const limit = jest.fn().mockResolvedValue({ data: rows, error: null });
      const order = jest.fn().mockReturnValue({ limit });
      const gte = jest.fn().mockReturnValue({ order });
      const eq = jest.fn().mockReturnValue({ gte });
      const select = jest.fn().mockReturnValue({ eq });
      const from = jest.fn().mockReturnValue({ select });
      const supabase = { client: { from } } as unknown as SupabaseService;
      const config = {
        getOrThrow: jest.fn((key: string) =>
          key === "STELLAR_RPC_URL" ? "https://rpc.test" : "Test SDF Network"
        ),
      } as unknown as ConfigService;

      return {
        service: new VaultPpsService(
          config,
          supabase,
          // These tests exercise Supabase reads, not RPC.
          {} as never
        ),
        order,
        limit,
      };
    }

    function hoursAgo(h: number): string {
      return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
    }

    it("requests the newest rows with an explicit limit", async () => {
      const { service, order, limit } = buildService([]);
      await service.getHistory("VAULT_A");

      expect(order).toHaveBeenCalledWith("recorded_at", { ascending: false });
      expect(limit).toHaveBeenCalledWith(10_000);
    });

    it("collapses duplicate recorders to one sample per hour, oldest first", async () => {
      // Newest-first, with three writers recording the same two hours.
      const { service } = buildService([
        { pps: "1030", recorded_at: hoursAgo(1) },
        { pps: "1029", recorded_at: hoursAgo(1) },
        { pps: "1028", recorded_at: hoursAgo(1) },
        { pps: "1010", recorded_at: hoursAgo(2) },
        { pps: "1009", recorded_at: hoursAgo(2) },
      ]);

      const { data } = await service.getHistory("VAULT_A");

      expect(data.map((r) => r.pps)).toEqual(["1010", "1030"]);
    });

    it("computes apy7d once the window reaches back seven days", async () => {
      const { service } = buildService([
        { pps: "1070", recorded_at: hoursAgo(1) },
        { pps: "1000", recorded_at: hoursAgo(7 * 24 - 1) },
      ]);

      const { apy7d } = await service.getHistory("VAULT_A");

      expect(apy7d).toBeCloseTo(365, 0);
    });
  });
});
