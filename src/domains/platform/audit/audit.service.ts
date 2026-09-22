import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  getAssetsConfig,
  getContractToCodeMap,
  getCurrentNetworkId,
  type NetworkId,
} from "@neko-protocol/keeper";
import { SupabaseService } from "@core/supabase/supabase.service";
import { NotificationsService } from "@domains/platform/notifications/notifications.service";
import { CreateAuditDto } from "./dto/create-audit.dto";

export interface LogAuditResult {
  ok: true;
  isFirstVaultDeposit?: boolean;
}

export type AuditRow = Record<string, unknown>;

/** Deposit-shaped actions that satisfy the `first_deposit` notification trigger. */
const NOTIFY_DEPOSIT_ACTIONS = new Set([
  "vaults_deposit",
  "lend_deposit",
  "pool_repay",
]);

/**
 * Token amounts for display. Trailing zeros are trimmed so a whole number reads
 * as "5" rather than "5.000000", and the cap keeps a float artefact from
 * rendering as a wall of digits in a one-line notification.
 */
function formatAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  const fixed = value.toFixed(value < 1 ? 6 : 2);
  return fixed.replace(/\.?0+$/, "");
}

export interface AuditQueryFilter {
  whereIn?: { column: string; values: (string | number)[] };
  gte?: { column: string; value: string };
  notNull?: string;
}

export interface AuditRecordInput {
  wallet_address: string | null;
  action_type: string;
  asset_in?: string | null;
  asset_out?: string | null;
  amount_in?: number | null;
  token_amount_in?: number | null;
  amount_out?: number | null;
  pool_id?: string | null;
  tx_hash?: string | null;
}

export interface RecordAuditResult {
  ok: boolean;
  error?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly networkId: NetworkId;
  private readonly dbNetwork: "mainnet" | "testnet";

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService
  ) {
    const raw = this.config.get<string>("STELLAR_NETWORK") ?? "mainnet";
    this.networkId = getCurrentNetworkId(raw);
    const upper = raw.trim().toUpperCase();
    this.dbNetwork =
      upper === "MAINNET" || upper === "PUBLIC" ? "mainnet" : "testnet";
  }

  private normalizeAssetKey(raw: string | null | undefined): string | null {
    if (raw == null) return null;
    const s = raw.trim();
    if (s === "") return null;

    const assets = getAssetsConfig(this.networkId);

    if (s.startsWith("C") && s.length === 56) {
      const byContract = getContractToCodeMap(this.networkId)[s];
      return byContract ?? s;
    }

    if (assets[s]) return assets[s].code;

    const upper = s.toUpperCase();
    for (const info of Object.values(assets)) {
      if (info.code.toUpperCase() === upper) return info.code;
    }

    return s;
  }

  private async latestPrice(symbol: string): Promise<number | null> {
    const { data } = await this.supabase.client
      .from("asset_price_history")
      .select("price")
      .eq("symbol", symbol.toUpperCase())
      .order("recorded_at", { ascending: false })
      .limit(1)
      .single();
    return data?.price && data.price > 0 ? data.price : null;
  }

  async log(dto: CreateAuditDto): Promise<LogAuditResult> {
    try {
      if (!dto.wallet_address || !dto.action_type) return { ok: true };

      const assetIn = this.normalizeAssetKey(dto.asset_in);
      const assetOut = this.normalizeAssetKey(dto.asset_out);

      const tokenAmountIn = dto.token_amount_in ?? null;
      let amountInUsd: number | null = null;
      if (assetIn && tokenAmountIn != null && Number.isFinite(tokenAmountIn)) {
        const price = await this.latestPrice(assetIn);
        if (price != null) amountInUsd = tokenAmountIn * price;
      }
      if (
        amountInUsd == null &&
        assetOut &&
        dto.amount_out != null &&
        Number.isFinite(dto.amount_out)
      ) {
        const price = await this.latestPrice(assetOut);
        if (price != null) amountInUsd = dto.amount_out * price;
      }

      const { data: inserted, error: insertError } = await this.supabase.client
        .from("audit_logs")
        .insert({
          wallet_address: dto.wallet_address,
          action_type: dto.action_type,
          asset_in: assetIn,
          asset_out: assetOut,
          amount_in: amountInUsd,
          token_amount_in: tokenAmountIn,
          amount_out: dto.amount_out ?? null,
          pool_id: dto.pool_id ?? null,
          network: this.dbNetwork,
          tx_hash: dto.tx_hash ?? null,
        })
        .select("id")
        .single();

      if (insertError || !inserted?.id) return { ok: true };

      const auditId = inserted.id;

      const bumpLeg = (
        assetKey: string | null | undefined,
        amount: number | null | undefined
      ) => {
        if (
          assetKey == null ||
          assetKey === "" ||
          amount == null ||
          !Number.isFinite(amount)
        ) {
          return Promise.resolve();
        }
        return this.supabase.client.rpc("increment_asset_volume", {
          p_network: this.dbNetwork,
          p_asset_key: assetKey,
          p_delta: amount,
          p_audit_id: auditId,
        });
      };

      await Promise.all([
        bumpLeg(assetIn, amountInUsd),
        bumpLeg(assetOut, dto.amount_out),
      ]);

      let isFirstVaultDeposit: boolean | undefined;
      if (dto.action_type === "vaults_deposit") {
        const { count } = await this.supabase.client
          .from("audit_logs")
          .select("id", { count: "exact", head: true })
          .eq("wallet_address", dto.wallet_address)
          .eq("action_type", "vaults_deposit");
        isFirstVaultDeposit = count === 1;
      }

      await this.notifyForAction(dto, auditId, assetIn, assetOut);

      return { ok: true, isFirstVaultDeposit };
    } catch (err) {
      this.logger.warn(`[audit] log failed: ${(err as Error).message}`);
      return { ok: true };
    }
  }

  /**
   * Fires the in-app notification for this action, in the same call that
   * recorded it, so the bell updates as soon as the transaction lands rather
   * than waiting on the mailing crons. The matching email still goes out later
   * on its own schedule, and on its own cadence: email fires on the first swap
   * or deposit only, while the tray gets one item per event.
   *
   * The audit row id is the dedupe key, which is what makes "every time" safe -
   * one notification per recorded action, and a retried request that inserts no
   * new audit row produces no new notification.
   */
  private async notifyForAction(
    dto: CreateAuditDto,
    auditId: string,
    assetIn: string | null,
    assetOut: string | null
  ): Promise<void> {
    const wallet = dto.wallet_address;
    if (!wallet) return;

    if (dto.action_type === "swap") {
      await this.notifications.emit({
        trigger: "swap_completed",
        walletAddress: wallet,
        dedupeKey: `swap:${auditId}`,
        params: {
          amount_in: formatAmount(dto.token_amount_in),
          asset_in: assetIn ?? "",
          amount_out: formatAmount(dto.amount_out),
          asset_out: assetOut ?? "",
        },
      });
      return;
    }

    if (NOTIFY_DEPOSIT_ACTIONS.has(dto.action_type)) {
      await this.notifications.emit({
        trigger: "first_deposit",
        walletAddress: wallet,
        dedupeKey: `deposit:${auditId}`,
        params: {
          amount: formatAmount(dto.token_amount_in),
          asset: assetIn ?? "",
          // For a vault deposit this is the share symbol, which reads as the
          // vault's name; pool actions fall back to the pool id.
          destination: assetOut ?? dto.pool_id ?? "",
        },
      });
    }
  }

  async list(
    wallet: string | undefined,
    limit: number
  ): Promise<Record<string, unknown>[]> {
    try {
      let query = this.supabase.client
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(Math.min(limit, 50));

      if (wallet) query = query.eq("wallet_address", wallet);

      const { data } = await query;
      return (data ?? []) as Record<string, unknown>[];
    } catch {
      return [];
    }
  }

  async listVaultActivity(wallet: string): Promise<Record<string, unknown>[]> {
    try {
      const { data } = await this.supabase.client
        .from("audit_logs")
        .select("*")
        .eq("wallet_address", wallet)
        .in("action_type", [
          "vaults_deposit",
          "vaults_withdraw",
          "vaults_claim_earnings",
        ])
        .order("created_at", { ascending: false })
        .limit(1_000);

      return (data ?? []) as Record<string, unknown>[];
    } catch {
      return [];
    }
  }

  async countMainnet(): Promise<number> {
    const { count } = await this.supabase.client
      .from("audit_logs")
      .select("*", { count: "exact", head: true })
      .eq("network", "mainnet");
    return count ?? 0;
  }

  async query(
    columns: string,
    filter: AuditQueryFilter = {}
  ): Promise<AuditRow[]> {
    const pageSize = 1000;
    let offset = 0;
    const out: AuditRow[] = [];
    for (;;) {
      let q = this.supabase.client
        .from("audit_logs")
        .select(columns)
        .eq("network", "mainnet")
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (filter.whereIn) {
        q = q.in(filter.whereIn.column, filter.whereIn.values);
      }
      if (filter.gte) {
        q = q.gte(filter.gte.column, filter.gte.value);
      }
      if (filter.notNull) {
        q = q.not(filter.notNull, "is", null);
      }
      const { data, error } = await q;
      if (error) break;
      const rows = (data ?? []) as unknown as AuditRow[];
      if (!rows.length) break;
      out.push(...rows);
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
    return out;
  }

  async recent(columns: string, limit: number): Promise<AuditRow[]> {
    const { data, error } = await this.supabase.client
      .from("audit_logs")
      .select(columns)
      .eq("network", "mainnet")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as unknown as AuditRow[];
  }

  async record(entry: AuditRecordInput): Promise<RecordAuditResult> {
    const { error } = await this.supabase.client.from("audit_logs").insert({
      wallet_address: entry.wallet_address,
      action_type: entry.action_type,
      asset_in: entry.asset_in ?? null,
      asset_out: entry.asset_out ?? null,
      amount_in: entry.amount_in ?? null,
      token_amount_in: entry.token_amount_in ?? null,
      amount_out: entry.amount_out ?? null,
      pool_id: entry.pool_id ?? null,
      network: this.dbNetwork,
      tx_hash: entry.tx_hash ?? null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }
}
