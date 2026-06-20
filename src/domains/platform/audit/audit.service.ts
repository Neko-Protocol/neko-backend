import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  getAssetsConfig,
  getContractToCodeMap,
  getCurrentNetworkId,
  type NetworkId,
} from "@neko/keeper";
import { SupabaseService } from "@core/supabase/supabase.service";
import { CreateAuditDto } from "./dto/create-audit.dto";

export interface LogAuditResult {
  ok: true;
  isFirstVaultDeposit?: boolean;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly networkId: NetworkId;
  private readonly dbNetwork: "mainnet" | "testnet";

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService
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

      return { ok: true, isFirstVaultDeposit };
    } catch (err) {
      this.logger.warn(`[audit] log failed: ${(err as Error).message}`);
      return { ok: true };
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
}
