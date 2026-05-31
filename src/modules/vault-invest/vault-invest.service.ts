import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Keypair, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { Client as DefindexVaultClient } from "@neko/defindex-vault";
import {
  getConfiguredRebalanceVaultIds,
  getVaultRebalanceConfig,
  parseAllVaultIds,
  planVaultRebalance,
  resolveVaultIdForApi,
  type ManagedFundsEntryLike,
  type PlannedInstruction,
  type TargetAllocation,
  type VaultRebalanceConfig,
} from "@neko/keeper";

export type KeeperMode = "cron" | "manual";

type AssembledTxLike = {
  simulation?: { error?: unknown };
  toXDR(): string;
};

type SdkResult = {
  tag?: string;
  value?: unknown;
  unwrap?: () => unknown;
};

export type TxResult = {
  hash: string;
  status: string;
};

export type FeesSummary = {
  attempted: boolean;
  results: Array<TxResult & { step: string }>;
  feesCollected: boolean;
};

export type RebalanceSummary = {
  attempted: boolean;
  reason: string;
  instructions: PlannedInstruction[];
  hash: string;
  status: string;
  idleAmount: number;
  idleAmountStroops: string;
  totalAmount: number;
  totalAmountStroops: string;
  targetAllocations: TargetAllocation[];
  canRebalance: boolean;
};

export type VaultKeeperResult = {
  vaultId: string;
  label: string;
  success: boolean;
  rebalance: RebalanceSummary;
  fees: FeesSummary;
  warnings: string[];
};

export type BatchKeeperResult = {
  success: boolean;
  mode: "batch";
  vaults: VaultKeeperResult[];
};

export type SingleVaultResult = {
  success: boolean;
  mode: "single";
  vaults: VaultKeeperResult[];
  invested: boolean;
  results: Array<{ strategy: string; hash: string; status: string }>;
  idleAmount: number;
  message?: string;
};

function unwrapSdkResult(raw: unknown): unknown {
  const r = raw as SdkResult;
  if (r?.tag === "ok") return r.value;
  if (typeof r?.unwrap === "function") return r.unwrap();
  return raw;
}

function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function amountToHuman(amount: bigint): number {
  return Number(amount) / 1e7;
}

function emptyFeesSummary(): FeesSummary {
  return { attempted: false, results: [], feesCollected: false };
}

function skippedRebalanceSummary(
  reason: string,
  plan?: {
    publicInstructions?: PlannedInstruction[];
    targetAllocations?: TargetAllocation[];
    idleAmount?: bigint;
    totalAmount?: bigint;
    canRebalance?: boolean;
  }
): RebalanceSummary {
  const idleAmount = plan?.idleAmount ?? 0n;
  const totalAmount = plan?.totalAmount ?? 0n;
  return {
    attempted: false,
    reason,
    instructions: plan?.publicInstructions ?? [],
    hash: "",
    status: "skipped",
    idleAmount: amountToHuman(idleAmount),
    idleAmountStroops: idleAmount.toString(),
    totalAmount: amountToHuman(totalAmount),
    totalAmountStroops: totalAmount.toString(),
    targetAllocations: plan?.targetAllocations ?? [],
    canRebalance: plan?.canRebalance ?? false,
  };
}

function skippedVaultResult(
  config: VaultRebalanceConfig,
  reason: string,
  warning?: string
): VaultKeeperResult {
  return {
    vaultId: config.vaultId,
    label: config.label,
    success: false,
    rebalance: skippedRebalanceSummary(reason),
    fees: emptyFeesSummary(),
    warnings: warning ? [warning] : [],
  };
}

function buildRebalanceSummary(
  plan: ReturnType<typeof planVaultRebalance>,
  txResult?: TxResult
): RebalanceSummary {
  const attempted = plan.instructions.length > 0;
  return {
    attempted,
    reason: plan.reason,
    instructions: plan.publicInstructions,
    hash: txResult?.hash ?? "",
    status: attempted ? (txResult?.status ?? "not_submitted") : "skipped",
    idleAmount: amountToHuman(plan.idleAmount),
    idleAmountStroops: plan.idleAmount.toString(),
    totalAmount: amountToHuman(plan.totalAmount),
    totalAmountStroops: plan.totalAmount.toString(),
    targetAllocations: plan.targetAllocations,
    canRebalance: plan.canRebalance,
  };
}

function legacyAliases(first: VaultKeeperResult | undefined): {
  invested: boolean;
  results: Array<{ strategy: string; hash: string; status: string }>;
  idleAmount: number;
  message?: string;
} {
  if (!first) {
    return {
      invested: false,
      results: [],
      idleAmount: 0,
      message: "No vault processed",
    };
  }
  const results = first.rebalance.attempted
    ? [
        {
          strategy: first.label,
          hash: first.rebalance.hash,
          status: first.rebalance.status,
        },
      ]
    : [];
  return {
    invested: first.rebalance.attempted,
    results,
    idleAmount: first.rebalance.idleAmount,
    message: first.rebalance.attempted
      ? undefined
      : first.rebalance.reason.replaceAll("_", " "),
  };
}

@Injectable()
export class VaultInvestService {
  private readonly logger = new Logger(VaultInvestService.name);
  private readonly lastInvest = new Map<string, number>();
  private readonly secretKey: string;
  private readonly rpcUrl: string;
  private readonly networkPassphrase: string;

  private static readonly COOLDOWN_MS = 5 * 60 * 1000;
  private static readonly BATCH_TIME_BUDGET_MS = 280_000;
  private static readonly TX_TIME_RESERVE_MS = 55_000;

  constructor(config: ConfigService) {
    this.secretKey = config.getOrThrow<string>("VAULT_MANAGER_SECRET_KEY");
    this.rpcUrl = config.getOrThrow<string>("STELLAR_RPC_URL");
    this.networkPassphrase = config.getOrThrow<string>(
      "STELLAR_NETWORK_PASSPHRASE"
    );
  }

  async runBatch(mode: KeeperMode): Promise<BatchKeeperResult> {
    const configs = this.configuredBatchVaults();
    const vaults = await this.executeKeeper(configs, "batch", mode);
    const success = vaults.every((v) => v.success);
    return { success, mode: "batch", vaults };
  }

  async runSingle(
    vaultId: string,
    mode: KeeperMode
  ): Promise<SingleVaultResult> {
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
    if (configs.length === 0) {
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
      const funds = await this.fetchManagedFunds(client);
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
        rebalanceTx = await this.sendTx(tx as AssembledTxLike, keypair, server);
        if (rebalanceTx.status !== "SUCCESS") {
          warnings.push(`Rebalance returned ${rebalanceTx.status}`);
        }
      } else if (plan.instructions.length > 0) {
        rebalanceTx = { hash: "", status: "skipped_timeout_budget" };
        warnings.push(
          "Rebalance skipped because the batch was close to timeout"
        );
      }

      const fees = await this.collectFees(client, keypair, server, deadlineMs);
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
        // missing trustline outside our vaults). Surface it as a warning but
        // do not fail the keeper when rebalance/invest itself succeeded.
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

  private async fetchManagedFunds(
    client: DefindexVaultClient
  ): Promise<ManagedFundsEntryLike[]> {
    const fundsTx = await client.fetch_total_managed_funds({ simulate: true });
    return unwrapSdkResult(fundsTx.result) as ManagedFundsEntryLike[];
  }

  private async waitForTx(
    server: rpc.Server,
    hash: string
  ): Promise<"SUCCESS" | "FAILED" | "TIMEOUT"> {
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const status = await server.getTransaction(hash);
      if (status.status === "SUCCESS") return "SUCCESS";
      if (status.status === "FAILED") return "FAILED";
    }
    return "TIMEOUT";
  }

  private async sendTx(
    assembledTx: AssembledTxLike,
    keypair: Keypair,
    server: rpc.Server
  ): Promise<TxResult> {
    if (assembledTx.simulation?.error) {
      return {
        hash: "",
        status: `sim_error: ${errorToString(assembledTx.simulation.error)}`,
      };
    }

    const builtTx = TransactionBuilder.fromXDR(
      assembledTx.toXDR(),
      this.networkPassphrase
    );
    const preparedTx = await server.prepareTransaction(builtTx);
    preparedTx.sign(keypair);
    const sendResult = await server.sendTransaction(preparedTx);
    if (sendResult.status !== "PENDING") {
      return { hash: sendResult.hash ?? "", status: "submit_error" };
    }
    const finalStatus = await this.waitForTx(server, sendResult.hash);
    return { hash: sendResult.hash, status: finalStatus };
  }

  private async collectFees(
    client: DefindexVaultClient,
    keypair: Keypair,
    server: rpc.Server,
    deadlineMs?: number
  ): Promise<FeesSummary> {
    const results: Array<TxResult & { step: string }> = [];

    if (!this.hasTransactionBudget(deadlineMs)) {
      results.push({
        step: "report",
        hash: "",
        status: "skipped_timeout_budget",
      });
      return { attempted: true, results, feesCollected: false };
    }

    try {
      const reportTx = await client.report();
      const r = await this.sendTx(reportTx as AssembledTxLike, keypair, server);
      results.push({ step: "report", ...r });
      if (r.status !== "SUCCESS") {
        return { attempted: true, results, feesCollected: false };
      }
    } catch (e) {
      results.push({
        step: "report",
        hash: "",
        status: `error: ${errorToString(e)}`,
      });
      return { attempted: true, results, feesCollected: false };
    }

    if (!this.hasTransactionBudget(deadlineMs)) {
      results.push({
        step: "lock_fees",
        hash: "",
        status: "skipped_timeout_budget",
      });
      return { attempted: true, results, feesCollected: false };
    }

    try {
      const lockTx = await client.lock_fees({ new_fee_bps: undefined });
      const r = await this.sendTx(lockTx as AssembledTxLike, keypair, server);
      results.push({ step: "lock_fees", ...r });
      if (r.status !== "SUCCESS") {
        return { attempted: true, results, feesCollected: false };
      }
    } catch (e) {
      results.push({
        step: "lock_fees",
        hash: "",
        status: `error: ${errorToString(e)}`,
      });
      return { attempted: true, results, feesCollected: false };
    }

    if (!this.hasTransactionBudget(deadlineMs)) {
      results.push({
        step: "distribute_fees",
        hash: "",
        status: "skipped_timeout_budget",
      });
      return { attempted: true, results, feesCollected: false };
    }

    try {
      const distTx = await client.distribute_fees({
        caller: keypair.publicKey(),
      });
      const r = await this.sendTx(distTx as AssembledTxLike, keypair, server);
      results.push({ step: "distribute_fees", ...r });
      return {
        attempted: true,
        results,
        feesCollected: r.status === "SUCCESS",
      };
    } catch (e) {
      results.push({
        step: "distribute_fees",
        hash: "",
        status: `error: ${errorToString(e)}`,
      });
      return { attempted: true, results, feesCollected: false };
    }
  }
}
