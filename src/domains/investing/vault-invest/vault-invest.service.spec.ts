/// <reference types="jest" />
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";

// VaultInvestService imports @neko-protocol/keeper (an ESM workspace package) and
// @neko-protocol/defindex-vault (the contract bindings). Jest's CJS loader cannot
// parse them, so stub just the named exports we touch.
jest.mock("@neko-protocol/keeper", () => ({
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

jest.mock("@neko-protocol/defindex-vault", () => ({
  Client: jest.fn().mockImplementation(() => ({})),
}));

import { Keypair } from "@stellar/stellar-sdk";
import {
  getConfiguredRebalanceVaultIds,
  parseAllVaultIds,
  getVaultRebalanceConfig,
} from "@neko-protocol/keeper";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";
import { NotificationsService } from "@domains/platform/notifications/notifications.service";
import { VaultInvestService } from "./vault-invest.service";
import type { VaultKeeperResult } from "./keeper/types";

describe("VaultInvestService", () => {
  // Throwaway keypair: the keeper only needs a decodable seed to reach the
  // balance guard, and no test submits a transaction.
  const VALID_SECRET = Keypair.random().secret();

  const notificationsStub = {
    vaultDepositors: jest
      .fn()
      .mockResolvedValue(["GDEPOSITOR1", "GDEPOSITOR2"]),
    emit: jest.fn().mockResolvedValue(undefined),
  };

  const stellarStub = {
    horizon: {
      loadAccount: jest.fn().mockResolvedValue({
        balances: [{ asset_type: "native", balance: "100.0000000" }],
        subentry_count: 0,
        num_sponsoring: 0,
        num_sponsored: 0,
      }),
    },
  };

  beforeEach(() => {
    process.env.VAULT_MANAGER_SECRET_KEY = VALID_SECRET;
    process.env.STELLAR_RPC_URL = "https://soroban-mainnet.example/rpc";
    process.env.STELLAR_NETWORK_PASSPHRASE =
      "Public Global Stellar Network ; September 2015";
  });

  async function buildModule() {
    return Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      providers: [
        VaultInvestService,
        { provide: StellarRpcService, useValue: stellarStub },
        { provide: NotificationsService, useValue: notificationsStub },
      ],
    }).compile();
  }

  describe("vault run notifications", () => {
    const vaultResult = (
      vaultId: string,
      attempted: boolean,
      status: string
    ): VaultKeeperResult =>
      ({
        vaultId,
        label: `Vault ${vaultId}`,
        success: true,
        rebalance: { attempted, status },
        warnings: [],
      }) as unknown as VaultKeeperResult;

    beforeEach(() => {
      notificationsStub.vaultDepositors.mockClear();
      notificationsStub.emit.mockClear();
    });

    it("notifies every depositor of a vault whose rebalance landed, deduped per day", async () => {
      const mod = await buildModule();
      const service = mod.get(VaultInvestService) as unknown as {
        notifyVaultRuns(vaults: VaultKeeperResult[]): void;
      };

      service.notifyVaultRuns([
        vaultResult("CRAN", true, "SUCCESS"),
        vaultResult("CSKIPPED", false, "skipped_cooldown"),
        vaultResult("CFAILED", true, "FAILED"),
      ]);
      await new Promise((resolve) => setImmediate(resolve));

      const day = new Date().toISOString().slice(0, 10);
      expect(notificationsStub.vaultDepositors).toHaveBeenCalledTimes(1);
      expect(notificationsStub.vaultDepositors).toHaveBeenCalledWith("CRAN");
      expect(notificationsStub.emit).toHaveBeenCalledTimes(2);
      expect(notificationsStub.emit).toHaveBeenCalledWith({
        trigger: "vault_run",
        walletAddress: "GDEPOSITOR1",
        dedupeKey: `vault_run:CRAN:${day}`,
        params: { vault: "Vault CRAN" },
      });
    });
  });

  it("runBatch returns an empty result when no vaults are configured", async () => {
    const mod = await buildModule();
    const result = await mod.get(VaultInvestService).runBatch("cron");
    expect(result.mode).toBe("batch");
    expect(result.vaults).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("aborts the run when the keeper cannot pay transaction fees", async () => {
    const vaultId = "CVAULT";
    jest.mocked(parseAllVaultIds).mockReturnValueOnce([vaultId]);
    jest.mocked(getConfiguredRebalanceVaultIds).mockReturnValueOnce([vaultId]);
    jest.mocked(getVaultRebalanceConfig).mockReturnValueOnce({
      vaultId,
      label: "Test Vault",
      strategies: [],
    });
    // 5 XLM balance fully locked by the base reserve of 8 subentries.
    stellarStub.horizon.loadAccount.mockResolvedValueOnce({
      balances: [{ asset_type: "native", balance: "5.0041160" }],
      subentry_count: 8,
      num_sponsoring: 0,
      num_sponsored: 0,
    });

    const mod = await buildModule();
    const result = await mod.get(VaultInvestService).runBatch("cron");

    expect(result.success).toBe(false);
    expect(result.vaults).toHaveLength(1);
    expect(result.vaults[0].rebalance.reason).toBe(
      "insufficient_keeper_balance"
    );
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
