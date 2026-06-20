import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";

// VaultInvestService imports @neko/keeper (an ESM workspace package) and
// @neko/defindex-vault (the contract bindings). Jest's CJS loader cannot
// parse them, so stub just the named exports we touch.
jest.mock("@neko/keeper", () => ({
  planVaultRebalance: jest.fn().mockReturnValue({
    attempted: false,
    reason: "no_idle_funds",
    instructions: [],
    publicInstructions: [],
    targetAllocations: [],
    idleAmount: 0n,
    totalAmount: 0n,
    canRebalance: false,
    warnings: [],
  }),
  getConfiguredRebalanceVaultIds: jest.fn().mockReturnValue([]),
  getVaultRebalanceConfig: jest.fn().mockReturnValue(undefined),
  VAULT_REBALANCE_CONFIGS: [],
  parseAllVaultIds: jest.fn().mockReturnValue([]),
  parseDefindexVaultIds: jest.fn().mockReturnValue([]),
  REBALANCE_THRESHOLD_STROOPS: 1000n,
  BLEND_KEEPER_VAULT_IDS: [],
  createDefindexServerSdk: jest.fn(),
  resolveVaultIdForApi: jest.fn().mockReturnValue(undefined),
  getVaultContractId: jest.fn(),
}));

jest.mock("@neko/defindex-vault", () => ({
  Client: jest.fn().mockImplementation(() => ({})),
}));

import { VaultInvestService } from "./vault-invest.service";

describe("VaultInvestService", () => {
  const VALID_SECRET = "S" + "A".repeat(55);

  beforeEach(() => {
    process.env.VAULT_MANAGER_SECRET_KEY = VALID_SECRET;
    process.env.STELLAR_RPC_URL = "https://soroban-mainnet.example/rpc";
    process.env.STELLAR_NETWORK_PASSPHRASE =
      "Public Global Stellar Network ; September 2015";
  });

  async function buildModule() {
    return Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      providers: [VaultInvestService],
    }).compile();
  }

  it("runBatch returns an empty result when no vaults are configured", async () => {
    const mod = await buildModule();
    const result = await mod.get(VaultInvestService).runBatch("cron");
    expect(result.mode).toBe("batch");
    expect(result.vaults).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("runSingle returns no-vault legacy shape when the id does not resolve", async () => {
    const mod = await buildModule();
    const result = await mod
      .get(VaultInvestService)
      .runSingle("unknown-vault", "manual");
    expect(result.mode).toBe("single");
    expect(result.vaults).toEqual([]);
    expect(result.invested).toBe(false);
    expect(result.results).toEqual([]);
    expect(result.message).toBe("No vault processed");
  });
});
