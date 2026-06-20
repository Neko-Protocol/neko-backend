import { Injectable } from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseService } from "@core/supabase/supabase.service";
import { AuditService } from "@domains/platform/audit/audit.service";
import { AuditLog, OverviewStats } from "./admin-dashboard.types";

type Row = Record<string, unknown>;

function isoStartOfDayUtc(daysAgo: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

function dateKeysLastNDays(days: number): string[] {
  const keys: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    );
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

function dateKeyFromIso(iso: string): string {
  return iso.slice(0, 10);
}

@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService
  ) {}

  private async fetchAllInPages(
    client: SupabaseClient,
    table: string,
    columns: string,
    filter?: { column: string; gte: string } | { notNullColumn: string }
  ): Promise<Row[]> {
    const orderColumn = table === "users" ? "wallet_address" : undefined;

    const pageSize = 1000;
    let offset = 0;
    const out: Row[] = [];
    for (;;) {
      let q = client
        .from(table)
        .select(columns)
        .range(offset, offset + pageSize - 1);
      if (orderColumn) q = q.order(orderColumn, { ascending: true });
      if (filter) {
        if ("notNullColumn" in filter) {
          q = q.not(filter.notNullColumn, "is", null);
        } else {
          q = q.gte(filter.column, filter.gte);
        }
      }
      const { data, error } = await q;
      if (error) break;
      const rows = (data ?? []) as unknown as Row[];
      if (!rows.length) break;
      out.push(...rows);
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
    return out;
  }

  async getOverviewStats(): Promise<OverviewStats> {
    const client = this.supabase.client;
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

    const [usersCount, newUsersCount, txCount, volumeRows, recentWallets] =
      await Promise.all([
        client.from("users").select("*", { count: "exact", head: true }),
        client
          .from("users")
          .select("*", { count: "exact", head: true })
          .gte("created_at", weekAgo),
        this.audit.countMainnet(),
        this.audit.query("amount_in", { notNull: "amount_in" }),
        this.audit.query("wallet_address", {
          gte: { column: "created_at", value: weekAgo },
        }),
      ]);

    const totalVolumeUsd = volumeRows.reduce((sum, r) => {
      const v = Number(r.amount_in);
      return sum + (Number.isFinite(v) && v > 0 ? v : 0);
    }, 0);

    const walletSet = new Set<string>();
    for (const r of recentWallets) {
      const w = r.wallet_address;
      if (typeof w === "string") walletSet.add(w);
    }

    return {
      totalUsers: usersCount.count ?? 0,
      newUsersThisWeek: newUsersCount.count ?? 0,
      totalTransactions: txCount,
      totalVolumeUsd,
      activeWalletsThisWeek: walletSet.size,
    };
  }

  async getDailyNewUsers(
    days = 30
  ): Promise<{ date: string; count: number }[]> {
    const client = this.supabase.client;
    const keys = dateKeysLastNDays(days);
    const start = isoStartOfDayUtc(days);
    const rows = await this.fetchAllInPages(client, "users", "created_at", {
      column: "created_at",
      gte: start,
    });

    const counts = new Map<string, number>();
    for (const r of rows) {
      const iso = r.created_at;
      if (typeof iso !== "string") continue;
      const k = dateKeyFromIso(iso);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return keys.map((date) => ({ date, count: counts.get(date) ?? 0 }));
  }

  async getWalletProviderBreakdown(): Promise<
    { provider: string; count: number }[]
  > {
    const rows = await this.fetchAllInPages(
      this.supabase.client,
      "users",
      "wallet_provider"
    );
    const counts = new Map<string, number>();
    for (const r of rows) {
      const p =
        typeof r.wallet_provider === "string" && r.wallet_provider.length
          ? r.wallet_provider
          : "unknown";
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([provider, count]) => ({ provider, count }))
      .sort((a, b) => b.count - a.count);
  }

  async getNetworkBreakdown(): Promise<{ network: string; count: number }[]> {
    const rows = await this.fetchAllInPages(
      this.supabase.client,
      "users",
      "network"
    );
    const counts = new Map<string, number>();
    for (const r of rows) {
      const n =
        typeof r.network === "string" && r.network.length
          ? r.network
          : "unknown";
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([network, count]) => ({ network, count }))
      .sort((a, b) => b.count - a.count);
  }

  async getCurrencyDistribution(): Promise<
    { currency: string; count: number }[]
  > {
    const rows = await this.fetchAllInPages(
      this.supabase.client,
      "users",
      "preferences"
    );
    const counts = new Map<string, number>();
    for (const r of rows) {
      const prefs = r.preferences;
      let cur = "default";
      if (prefs && typeof prefs === "object" && prefs !== null) {
        const c = (prefs as { currency?: unknown }).currency;
        cur = typeof c === "string" && c.length ? c : "default";
      }
      counts.set(cur, (counts.get(cur) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([currency, count]) => ({ currency, count }))
      .sort((a, b) => b.count - a.count);
  }

  async getTransactionsByType(): Promise<
    { action_type: string; count: number }[]
  > {
    const rows = await this.audit.query("action_type");
    const counts = new Map<string, number>();
    for (const r of rows) {
      const t = typeof r.action_type === "string" ? r.action_type : "unknown";
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([action_type, count]) => ({ action_type, count }))
      .sort((a, b) => b.count - a.count);
  }

  async getDailyTransactions(
    days = 30
  ): Promise<{ date: string; count: number }[]> {
    const keys = dateKeysLastNDays(days);
    const start = isoStartOfDayUtc(days);
    const rows = await this.audit.query("created_at", {
      gte: { column: "created_at", value: start },
    });

    const counts = new Map<string, number>();
    for (const r of rows) {
      const iso = r.created_at;
      if (typeof iso !== "string") continue;
      const k = dateKeyFromIso(iso);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return keys.map((date) => ({ date, count: counts.get(date) ?? 0 }));
  }

  async getTopAssetsByVolume(
    limit = 10
  ): Promise<
    { asset_key: string; total_volume: number; touch_count: number }[]
  > {
    const { data, error } = await this.supabase.client
      .from("asset_volume_stats")
      .select("asset_key,total_volume,touch_count")
      .order("total_volume", { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    return data.map((r) => ({
      asset_key: String(r.asset_key),
      total_volume: Number(r.total_volume) || 0,
      touch_count: Number(r.touch_count) || 0,
    }));
  }

  async getRecentActivity(limit = 50): Promise<AuditLog[]> {
    const rows = await this.audit.recent(
      [
        "id",
        "wallet_address",
        "action_type",
        "asset_in",
        "asset_out",
        "amount_in",
        "token_amount_in",
        "amount_out",
        "pool_id",
        "network",
        "tx_hash",
        "created_at",
      ].join(","),
      limit
    );
    return rows as unknown as AuditLog[];
  }

  async getEmailVerificationStats(): Promise<{
    verifiedCount: number;
    totalCount: number;
  }> {
    const client = this.supabase.client;
    const rows = await this.fetchAllInPages(
      client,
      "users",
      "email_verified_at"
    );
    let verifiedCount = 0;
    for (const r of rows) {
      if (r.email_verified_at != null) verifiedCount++;
    }

    const { count: totalCount } = await client
      .from("users")
      .select("*", { count: "exact", head: true });

    return { verifiedCount, totalCount: totalCount ?? rows.length };
  }
}
