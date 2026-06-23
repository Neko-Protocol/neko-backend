import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client as DefindexVaultClient } from "@neko/defindex-vault";
import { parseAllVaultIds } from "@neko/keeper";
import { fetchManagedFunds } from "../vault-invest/keeper/tx";
import { SupabaseService } from "@core/supabase/supabase.service";

export interface RecordPpsResult {
  inserted: number;
}

export interface VaultPpsHistoryRow {
  pps: string;
  recorded_at: string;
}

export interface VaultPpsHistoryResult {
  data: VaultPpsHistoryRow[];
  apy7d: number | null;
}

const ONE_SHARE = 1_000_000_000_000n;

@Injectable()
export class VaultPpsService {
  private readonly logger = new Logger(VaultPpsService.name);
  private readonly rpcUrl: string;
  private readonly networkPassphrase: string;
  private readonly allowHttp: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService
  ) {
    this.rpcUrl = config.getOrThrow<string>("STELLAR_RPC_URL");
    this.networkPassphrase = config.getOrThrow<string>(
      "STELLAR_NETWORK_PASSPHRASE"
    );
    this.allowHttp = this.rpcUrl.startsWith("http://");
  }

  async recordOnce(): Promise<RecordPpsResult> {
    const vaultIds = parseAllVaultIds();
    const rows: { vault_id: string; pps: string }[] = [];

    for (const vaultId of vaultIds) {
      try {
        const client = new DefindexVaultClient({
          contractId: vaultId,
          rpcUrl: this.rpcUrl,
          networkPassphrase: this.networkPassphrase,
          ...(this.allowHttp ? { allowHttp: true } : {}),
        });
        const entries = await fetchManagedFunds(client);
        const first = entries[0];
        const tvl =
          first?.total_amount != null
            ? BigInt(first.total_amount.toString())
            : 0n;
        const totalSupplyTx = await client.total_supply({ simulate: true });
        const totalShares = BigInt(totalSupplyTx.result?.toString() ?? "0");
        const pps = totalShares > 0n ? (tvl * ONE_SHARE) / totalShares : 0n;
        if (pps > 0n) {
          rows.push({ vault_id: vaultId, pps: pps.toString() });
        }
      } catch (err) {
        this.logger.warn(
          `[vault-pps] vault ${vaultId} failed: ${(err as Error).message}`
        );
      }
    }

    if (rows.length === 0) {
      this.logger.log("[vault-pps] nothing to insert");
      return { inserted: 0 };
    }

    const { error } = await this.supabase.client
      .from("vault_pps_history")
      .insert(rows);

    if (error) {
      this.logger.error(`[vault-pps] insert failed: ${error.message}`);
      throw new Error(error.message);
    }

    this.logger.log(`[vault-pps] inserted ${rows.length} rows`);
    return { inserted: rows.length };
  }

  async getHistory(vaultId: string): Promise<VaultPpsHistoryResult> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.supabase.client
      .from("vault_pps_history")
      .select("pps, recorded_at")
      .eq("vault_id", vaultId)
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: true });

    if (error) {
      this.logger.error(`[vault-pps] history failed: ${error.message}`);
      throw new Error(error.message);
    }

    const series = (data ?? []) as VaultPpsHistoryRow[];
    const sevenDaysAgo = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    let apy7d: number | null = null;
    if (series.length > 0) {
      const ppsNow = Number(series[series.length - 1].pps);
      const pastRow = series.find((r) => r.recorded_at >= sevenDaysAgo);
      if (pastRow) {
        const ppsPast = Number(pastRow.pps);
        apy7d = ppsPast > 0 ? (ppsNow / ppsPast - 1) * (365 / 7) * 100 : null;
      }
    }

    return { data: series, apy7d };
  }
}
