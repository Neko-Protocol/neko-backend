import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Keypair, rpc } from "@stellar/stellar-sdk";
import { Client as DefindexVaultClient } from "@neko-protocol/defindex-vault";
import {
  REBALANCE_THRESHOLD_STROOPS,
  getConfiguredRebalanceVaultIds,
  getVaultRebalanceConfig,
  parseAllVaultIds,
  planVaultRebalance,
  resolveVaultIdForApi,
  type VaultRebalanceConfig,
} from "@neko-protocol/keeper";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";
import { NotificationsService } from "@domains/platform/notifications/notifications.service";
import { collectFees } from "./keeper/fees";
import {
  amountToHuman,
  buildRebalanceSummary,
  emptyFeesSummary,
  errorToString,
  legacyAliases,
  skippedRebalanceSummary,
  skippedVaultResult,
} from "./keeper/helpers";
import { fetchManagedFunds, sendTx } from "./keeper/tx";
import type {
  AssembledTxLike,
  BatchKeeperResult,
  KeeperMode,
  SingleVaultResult,
  TxResult,
  VaultKeeperResult,
} from "./keeper/types";

export type {
  BatchKeeperResult,
  KeeperMode,
  SingleVaultResult,
  VaultKeeperResult,
} from "./keeper/types";

const BASE_RESERVE_STROOPS = 5_000_000n;
const STROOPS_PER_XLM = 10_000_000;

function xlm(stroops: bigint): string {
  return (Number(stroops) / STROOPS_PER_XLM).toFixed(7);
}

function toStroops(amount: string): bigint {
  return BigInt(Math.round(parseFloat(amount) * STROOPS_PER_XLM));
}

@Injectable()
export class VaultInvestService {
  private readonly logger = new Logger(VaultInvestService.name);
  private readonly lastInvest = new Map<string, number>();
  private readonly idleStreak = new Map<string, number>();
  private readonly secretKey: string | undefined;
  private readonly rpcUrl: string;
  private readonly networkPassphrase: string;

  private static readonly COOLDOWN_MS = 5 * 60 * 1000;
  private static readonly BATCH_TIME_BUDGET_MS = 280_000;
  private static readonly TX_TIME_RESERVE_MS = 55_000;
  // A rebalance costs ~0.008 XLM and a full batch adds fee-collection txs on
  // top, so abort well before the account can no longer pay for a single one.
  private static readonly MIN_SPENDABLE_STROOPS = 10_000_000n;
  private static readonly LOW_BALANCE_STROOPS = 50_000_000n;
  private static readonly IDLE_ALERT_RUNS = 3;

  constructor(
    config: ConfigService,
    private readonly stellar: StellarRpcService,
    private readonly notifications: NotificationsService
  ) {
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
    this.notifyVaultRuns(vaults);
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
    this.notifyVaultRuns(vaults);
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

  /**
   * XLM the keeper can actually spend on fees, i.e. balance minus the base
   * reserve its subentries lock up. Returns null when Horizon is unreachable so
   * a lookup failure never blocks a run on its own.
   */
  /**
   * In-app + push "vault run" for every depositor of each vault whose rebalance
   * transaction landed. Deduped per vault per UTC day, so a vault that runs
   * every 30 minutes notifies a depositor at most once a day. Not awaited: the
   * keeper run shouldn't wait on notification delivery.
   */
  private notifyVaultRuns(vaults: VaultKeeperResult[]): void {
    const day = new Date().toISOString().slice(0, 10);
    for (const vault of vaults) {
      if (!vault.rebalance.attempted || vault.rebalance.status !== "SUCCESS") {
        continue;
      }
      void this.notifyDepositors(vault.vaultId, vault.label, day);
    }
  }

  private async notifyDepositors(
    vaultId: string,
    label: string,
    day: string
  ): Promise<void> {
    try {
      const wallets = await this.notifications.vaultDepositors(vaultId);
      for (const wallet of wallets) {
        await this.notifications.emit({
          trigger: "vault_run",
          walletAddress: wallet,
          dedupeKey: `vault_run:${vaultId}:${day}`,
          params: { vault: label },
        });
      }
    } catch (err) {
      this.logger.warn(
        `vault ${label} (${vaultId}) run notification failed: ${(err as Error).message}`
      );
    }
  }

  private async spendableStroops(publicKey: string): Promise<bigint | null> {
    try {
      const account = await this.stellar.horizon.loadAccount(publicKey);
      const native = account.balances.find(
        (b): b is typeof b & { asset_type: "native" } =>
          b.asset_type === "native"
      );
      if (!native) return 0n;

      const reservedEntries =
        2 +
        account.subentry_count +
        (account.num_sponsoring ?? 0) -
        (account.num_sponsored ?? 0);

      return (
        toStroops(native.balance) -
        toStroops(native.selling_liabilities ?? "0") -
        BigInt(reservedEntries) * BASE_RESERVE_STROOPS
      );
    } catch (e) {
      this.logger.warn(
        `Could not read keeper XLM balance for ${publicKey}: ${errorToString(e)}`
      );
      return null;
    }
  }

  /**
   * Flags vaults whose idle balance stays above the invest threshold across
   * consecutive runs — the signature of a keeper that plans correctly but never
   * lands its transaction.
   */
  private trackIdleStreak(
    config: VaultRebalanceConfig,
    idleStroops: bigint,
    idleHuman: number,
    rebalanceOk: boolean
  ): void {
    const stuck = idleStroops >= REBALANCE_THRESHOLD_STROOPS && !rebalanceOk;
    if (!stuck) {
      this.idleStreak.delete(config.vaultId);
      return;
    }

    const streak = (this.idleStreak.get(config.vaultId) ?? 0) + 1;
    this.idleStreak.set(config.vaultId, streak);

    if (streak >= VaultInvestService.IDLE_ALERT_RUNS) {
      this.logger.error(
        `vault ${config.label} (${config.vaultId}) has ${idleHuman} idle above the invest threshold for ${streak} consecutive runs — these funds are not earning yield`
      );
    }
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

    const spendable = await this.spendableStroops(keypair.publicKey());
    if (
      spendable !== null &&
      spendable < VaultInvestService.MIN_SPENDABLE_STROOPS
    ) {
      this.logger.error(
        `keeper account ${keypair.publicKey()} has only ${xlm(spendable)} XLM spendable (minimum ${xlm(VaultInvestService.MIN_SPENDABLE_STROOPS)} XLM) — aborting run, no vault will be rebalanced until it is funded`
      );
      return configs.map((config) =>
        skippedVaultResult(
          config,
          "insufficient_keeper_balance",
          `Keeper account has ${xlm(spendable)} XLM spendable, not enough to pay transaction fees`
        )
      );
    }

    if (
      spendable !== null &&
      spendable < VaultInvestService.LOW_BALANCE_STROOPS
    ) {
      this.logger.warn(
        `keeper account ${keypair.publicKey()} is low on XLM: ${xlm(spendable)} spendable — top it up before it can no longer pay fees`
      );
    }

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
      server: this.stellar.rpc,
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
          this.logger.error(
            `vault ${config.label} (${config.vaultId}) rebalance did not land: ${rebalanceTx.status} — ${plan.publicInstructions.length} instruction(s), ${amountToHuman(plan.idleAmount)} idle`
          );
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
        this.logger.warn(
          `vault ${config.label} (${config.vaultId}) fee collection did not complete`
        );
      }

      const rebalance = buildRebalanceSummary(plan, rebalanceTx);
      const rebalanceOk =
        !rebalance.attempted || rebalance.status === "SUCCESS";

      this.trackIdleStreak(
        config,
        plan.idleAmount,
        rebalance.idleAmount,
        rebalanceOk
      );

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
