import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client as DefindexVaultClient } from "@neko/defindex-vault";
import { parseAllVaultIds } from "@neko/keeper";
import { fetchManagedFunds } from "../vault-invest/keeper/tx";
import { SupabaseService } from "../supabase/supabase.service";

export interface RecordPpsResult {
  inserted: number;
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
}
