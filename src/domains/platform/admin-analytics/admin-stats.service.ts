import { Injectable, Logger } from "@nestjs/common";
import type {
  AuditActionType,
  ListTransactionsFilters,
  ListTransactionsResult,
  OverviewStats,
  UserStats,
} from "@neko-protocol/api-contracts";
import { SupabaseService } from "@core/supabase/supabase.service";
import { AdminVaultReportingService } from "./admin-vault-reporting.service";

const SWAP: AuditActionType = "swap";
const VAULTS_DEPOSIT: AuditActionType = "vaults_deposit";

/**
 * Platform-wide stats: overview totals, user counts, and the transactions
 * list. Pure Supabase aggregation — all on-chain vault balance/pricing math
 * lives in `AdminVaultReportingService` instead.
 */
@Injectable()
export class AdminStatsService {
  private readonly logger = new Logger(AdminStatsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly vaultReporting: AdminVaultReportingService
  ) {}

  async getOverview(): Promise<OverviewStats> {
    const [tvlUsd, volumeUsd, swapsCount, swapsVolumeUsd] = await Promise.all([
      this.vaultReporting.getVaultsTvlUsd(),
      this.getTransactionVolumeUsd([VAULTS_DEPOSIT, SWAP]),
      this.getSwapsCount(),
      this.getTransactionVolumeUsd([SWAP]),
    ]);
    return { tvlUsd, volumeUsd, swapsCount, swapsVolumeUsd };
  }

  // `asset_volume_stats` bumps both the asset_in AND asset_out leg of every
  // transaction, so summing it double-counts economic volume. Reading
  // audit_logs directly and taking one side per row (amount_in, falling back
  // to amount_out) gives the real, non-duplicated transaction volume.
  private async getTransactionVolumeUsd(
    actionTypes?: AuditActionType[]
  ): Promise<number> {
    let query = this.supabase.client
      .from("audit_logs")
      .select("amount_in, amount_out")
      .eq("network", "mainnet");
    if (actionTypes) query = query.in("action_type", actionTypes);

    const { data } = await query;
    return (data ?? []).reduce(
      (
        sum: number,
        row: { amount_in: number | null; amount_out: number | null }
      ) => sum + Number(row.amount_in ?? row.amount_out ?? 0),
      0
    );
  }

  private async getSwapsCount(): Promise<number> {
    const { count } = await this.supabase.client
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("network", "mainnet")
      .eq("action_type", SWAP);
    return count ?? 0;
  }

  async getUserStats(): Promise<UserStats> {
    const [totalUsersRes, emailConfirmedRes, depositRowsRes] =
      await Promise.all([
        this.supabase.client
          .from("users")
          .select("wallet_address", { count: "exact", head: true })
          .eq("network", "mainnet"),
        this.supabase.client
          .from("users")
          .select("wallet_address", { count: "exact", head: true })
          .eq("network", "mainnet")
          .not("email_verified_at", "is", null),
        this.supabase.client
          .from("audit_logs")
          .select("wallet_address")
          .eq("network", "mainnet")
          .eq("action_type", VAULTS_DEPOSIT),
      ]);

    const depositCounts = new Map<string, number>();
    for (const row of depositRowsRes.data ?? []) {
      const wallet = row.wallet_address as string | null;
      if (!wallet) continue;
      depositCounts.set(wallet, (depositCounts.get(wallet) ?? 0) + 1);
    }

    let investedCount = 0;
    let reinvestedCount = 0;
    for (const count of depositCounts.values()) {
      if (count >= 1) investedCount += 1;
      if (count >= 2) reinvestedCount += 1;
    }

    const totalUsers = totalUsersRes.count ?? 0;
    const emailConfirmed = emailConfirmedRes.count ?? 0;
    return {
      totalUsers,
      emailConfirmed,
      emailConfirmedPct: totalUsers > 0 ? emailConfirmed / totalUsers : 0,
      investedCount,
      investedPct: totalUsers > 0 ? investedCount / totalUsers : 0,
      reinvestedCount,
      reinvestedPct: totalUsers > 0 ? reinvestedCount / totalUsers : 0,
    };
  }

  async listTransactions(
    filters: ListTransactionsFilters
  ): Promise<ListTransactionsResult> {
    const limit = Math.min(filters.limit ?? 25, 100);
    const offset = Math.max(filters.offset ?? 0, 0);

    let query = this.supabase.client
      .from("audit_logs")
      .select(
        "id, created_at, action_type, wallet_address, amount_in, amount_out, asset_in, asset_out, tx_hash",
        { count: "exact" }
      )
      .eq("network", "mainnet")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (filters.actionType) query = query.eq("action_type", filters.actionType);
    if (filters.wallet) query = query.eq("wallet_address", filters.wallet);
    if (filters.from) query = query.gte("created_at", filters.from);
    if (filters.to) query = query.lte("created_at", filters.to);

    const { data, count, error } = await query;
    if (error) {
      this.logger.warn(
        `[admin-stats] listTransactions failed: ${error.message}`
      );
      return { rows: [], total: 0 };
    }

    const rows = data ?? [];
    const wallets = Array.from(
      new Set(
        rows
          .map((r) => r.wallet_address as string | null)
          .filter((w): w is string => Boolean(w))
      )
    );

    let emailByWallet = new Map<string, string>();
    if (wallets.length > 0) {
      const { data: users } = await this.supabase.client
        .from("users")
        .select("wallet_address, email")
        .in("wallet_address", wallets);
      emailByWallet = new Map(
        (users ?? [])
          .filter((u: { email: string | null }) => u.email)
          .map((u: { wallet_address: string; email: string }) => [
            u.wallet_address,
            u.email,
          ])
      );
    }

    return {
      rows: rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        actionType: r.action_type,
        walletAddress: r.wallet_address,
        email: r.wallet_address
          ? (emailByWallet.get(r.wallet_address) ?? null)
          : null,
        amountIn: r.amount_in,
        amountOut: r.amount_out,
        assetIn: r.asset_in,
        assetOut: r.asset_out,
        txHash: r.tx_hash,
      })),
      total: count ?? rows.length,
    };
  }
}
