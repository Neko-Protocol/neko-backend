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
      ],
    }).compile();

    const result = await mod.get(VaultPpsService).recordOnce();
    expect(result.inserted).toBe(1);
    expect(from).toHaveBeenCalledWith("vault_pps_history");
    expect(insert).toHaveBeenCalledWith([
      { vault_id: "VAULT_A", pps: "2000000000000" },
    ]);
  });
});
