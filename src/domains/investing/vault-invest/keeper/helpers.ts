import type {
  PlannedInstruction,
  TargetAllocation,
  VaultRebalanceConfig,
  planVaultRebalance,
} from "@neko-protocol/keeper";
import type {
  FeesSummary,
  RebalanceSummary,
  SdkResult,
  TxResult,
  VaultKeeperResult,
} from "./types";

export function unwrapSdkResult(raw: unknown): unknown {
  const r = raw as SdkResult;
  if (r?.tag === "ok") return r.value;
  if (typeof r?.unwrap === "function") return r.unwrap();
  return raw;
}

export function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function amountToHuman(amount: bigint): number {
  return Number(amount) / 1e7;
}

export function emptyFeesSummary(): FeesSummary {
  return { attempted: false, results: [], feesCollected: false };
}

export function skippedRebalanceSummary(
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

export function skippedVaultResult(
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

export function buildRebalanceSummary(
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

export function legacyAliases(first: VaultKeeperResult | undefined): {
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
