import type { PlannedInstruction, TargetAllocation } from "@neko-protocol/keeper";

export type KeeperMode = "cron" | "manual";

export type AssembledTxLike = {
  simulation?: { error?: unknown };
  toXDR(): string;
};

export type SdkResult = {
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
