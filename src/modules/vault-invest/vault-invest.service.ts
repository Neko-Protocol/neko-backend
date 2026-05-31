import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Keypair, rpc } from "@stellar/stellar-sdk";
import { Client as DefindexVaultClient } from "@neko/defindex-vault";
import {
  getConfiguredRebalanceVaultIds,
  getVaultRebalanceConfig,
  parseAllVaultIds,
  planVaultRebalance,
  resolveVaultIdForApi,
  type VaultRebalanceConfig,
} from "@neko/keeper";
import { collectFees } from "./keeper-fees";
import {
  buildRebalanceSummary,
  emptyFeesSummary,
  errorToString,
  legacyAliases,
  skippedRebalanceSummary,
  skippedVaultResult,
} from "./keeper-helpers";
import { fetchManagedFunds, sendTx } from "./keeper-tx";
import type {
  AssembledTxLike,
  BatchKeeperResult,
  KeeperMode,
  SingleVaultResult,
  TxResult,
  VaultKeeperResult,
} from "./keeper-types";

export type {
  BatchKeeperResult,
  KeeperMode,
  SingleVaultResult,
  VaultKeeperResult,
} from "./keeper-types";

@Injectable()
export class VaultInvestService {
  private readonly logger = new Logger(VaultInvestService.name);
  private readonly lastInvest = new Map<string, number>();
  private readonly secretKey: string | undefined;
  private readonly rpcUrl: string;
  private readonly networkPassphrase: string;

  private static readonly COOLDOWN_MS = 5 * 60 * 1000;
  private static readonly BATCH_TIME_BUDGET_MS = 280_000;
  private static readonly TX_TIME_RESERVE_MS = 55_000;

  constructor(config: ConfigService) {
    this.secretKey =
      config.get<string>("VAULT_MANAGER_SECRET_KEY") || undefined;
    this.rpcUrl = config.getOrThrow<string>("STELLAR_RPC_URL");
    this.networkPassphrase = config.getOrThrow<string>(
      "STELLAR_NETWORK_PASSPHRASE"
    );
    if (!this.secretKey) {
      this.logger.warn(
        "VAULT_MANAGER_SECRET_KEY not set — keeper runs will be skipped"
      );
    }
  }

  async runBatch(mode: KeeperMode): Promise<BatchKeeperResult> {
    if (!this.secretKey) {
      return { success: true, mode: "batch", vaults: [] };
    }
    const configs = this.configuredBatchVaults();
    const vaults = await this.executeKeeper(configs, "batch", mode);
    const success = vaults.every((v) => v.success);
    return { success, mode: "batch", vaults };
  }

  async runSingle(
    vaultId: string,
    mode: KeeperMode
  ): Promise<SingleVaultResult> {
    if (!this.secretKey) {
      return {
        success: true,
        mode: "single",
        vaults: [],
        invested: false,
        results: [],
        idleAmount: 0,
      };
    }
    const resolvedVaultId = resolveVaultIdForApi(vaultId);
    const config = resolvedVaultId
      ? getVaultRebalanceConfig(resolvedVaultId)
      : undefined;
    const configs = config ? [config] : [];
    const vaults = await this.executeKeeper(configs, "single", mode);
    const success = vaults.every((v) => v.success);
    return {
      success,
      mode: "single",
      vaults,
      ...legacyAliases(vaults[0]),
    };
  }

  private configuredBatchVaults(): VaultRebalanceConfig[] {
    const allowed = new Set(parseAllVaultIds());
    return getConfiguredRebalanceVaultIds()
      .filter((vaultId) => allowed.has(vaultId))
      .map((vaultId) => getVaultRebalanceConfig(vaultId))
      .filter((c): c is VaultRebalanceConfig => Boolean(c));
  }

  private cooldownRemainingSeconds(vaultId: string): number {
    return Math.max(
      0,
      Math.ceil(
        ((this.lastInvest.get(vaultId) ?? 0) +
          VaultInvestService.COOLDOWN_MS -
          Date.now()) /
          1000
      )
    );
  }

  private hasTransactionBudget(deadlineMs?: number): boolean {
    if (!deadlineMs) return true;
    return Date.now() + VaultInvestService.TX_TIME_RESERVE_MS < deadlineMs;
  }

  private async executeKeeper(
    configs: VaultRebalanceConfig[],
    callMode: "batch" | "single",
    mode: KeeperMode
  ): Promise<VaultKeeperResult[]> {
    if (configs.length === 0 || !this.secretKey) {
      return [];
    }

    const keypair = Keypair.fromSecret(this.secretKey);
    const server = new rpc.Server(this.rpcUrl);
    const startedAt = Date.now();
    const deadlineMs = startedAt + VaultInvestService.BATCH_TIME_BUDGET_MS;
    const vaults: VaultKeeperResult[] = [];

    for (const config of configs) {
      if (!this.hasTransactionBudget(deadlineMs)) {
        vaults.push(
          skippedVaultResult(
            config,
            "skipped_timeout_budget",
            "Skipped because the batch was close to the duration budget"
          )
        );
        continue;
      }

      if (mode === "manual") {
        const remaining = this.cooldownRemainingSeconds(config.vaultId);
        if (remaining > 0) {
          vaults.push(
            skippedVaultResult(
              config,
              "skipped_cooldown",
              `Please wait ${remaining}s`
            )
          );
          continue;
        }
      }

      this.lastInvest.set(config.vaultId, Date.now());
      vaults.push(
        await this.runVaultKeeper(config, keypair, server, deadlineMs)
      );
    }

    if (callMode === "single" && vaults.length === 0) {
      this.logger.warn(
        "vault-invest single run: no configured vault matched the requested id"
      );
    }

    return vaults;
  }

  private async runVaultKeeper(
    config: VaultRebalanceConfig,
    keypair: Keypair,
    server: rpc.Server,
    deadlineMs?: number
  ): Promise<VaultKeeperResult> {
    const warnings: string[] = [];
    const client = new DefindexVaultClient({
      contractId: config.vaultId,
      rpcUrl: this.rpcUrl,
      networkPassphrase: this.networkPassphrase,
      publicKey: keypair.publicKey(),
    });

    try {
      const funds = await fetchManagedFunds(client);
      const plan = planVaultRebalance(config, funds);
      warnings.push(...plan.warnings);

      let rebalanceTx: TxResult | undefined;
      if (
        plan.instructions.length > 0 &&
        this.hasTransactionBudget(deadlineMs)
      ) {
        const tx = await client.rebalance({
          caller: keypair.publicKey(),
          instructions: plan.instructions,
        });
        rebalanceTx = await sendTx(
          tx as AssembledTxLike,
          keypair,
          server,
          this.networkPassphrase
        );
        if (rebalanceTx.status !== "SUCCESS") {
          warnings.push(`Rebalance returned ${rebalanceTx.status}`);
        }
      } else if (plan.instructions.length > 0) {
        rebalanceTx = { hash: "", status: "skipped_timeout_budget" };
        warnings.push(
          "Rebalance skipped because the batch was close to timeout"
        );
      }

      const fees = await collectFees({
        client,
        keypair,
        server,
        networkPassphrase: this.networkPassphrase,
        hasBudget: () => this.hasTransactionBudget(deadlineMs),
      });
      if (!fees.feesCollected) {
        warnings.push("Fee collection did not complete successfully");
      }

      const rebalance = buildRebalanceSummary(plan, rebalanceTx);
      const rebalanceOk =
        !rebalance.attempted || rebalance.status === "SUCCESS";

      return {
        vaultId: config.vaultId,
        label: config.label,
        // Fee distribution can fail due to protocol receiver setup (e.g.,
        // missing trustline outside our vaults). Surface as warning instead
        // of failing the vault when rebalance/invest itself succeeded.
        success: rebalanceOk,
        rebalance,
        fees,
        warnings,
      };
    } catch (e) {
      const message = errorToString(e);
      this.logger.error(
        `vault ${config.label} (${config.vaultId}) failed: ${message}`
      );
      return {
        vaultId: config.vaultId,
        label: config.label,
        success: false,
        rebalance: skippedRebalanceSummary("error"),
        fees: emptyFeesSummary(),
        warnings: [...warnings, message],
      };
    }
  }
}
