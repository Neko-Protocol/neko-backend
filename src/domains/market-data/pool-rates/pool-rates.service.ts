import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { ErrorCode } from "@neko/api-contracts";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";
import { SupabaseService } from "@core/supabase/supabase.service";
import { BlendPoolAdapter } from "./adapters/blend-pool.adapter";
import type { PoolRateRow } from "./adapters/blend-pool.adapter";
import { AquaPoolAdapter } from "./adapters/aqua-pool.adapter";
import { getBlendPoolIds } from "./adapters/blend-config";
import type { PoolRateHistoryEntryDto } from "./dto/pool-rate-history-entry.dto";
import type { RecordRatesResponseDto } from "./dto/record-rates-response.dto";

@Injectable()
export class PoolRatesService {
  private readonly logger = new Logger(PoolRatesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly stellar: StellarRpcService
  ) {}

  async getHistory(poolId: string): Promise<PoolRateHistoryEntryDto[]> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.supabase.client
      .from("pool_rate_history")
      .select("supply_apy, borrow_apy, recorded_at")
      .eq("pool_id", poolId)
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: true });

    if (error) {
      this.logger.error("Failed to fetch pool rate history", error);
      throw new InternalServerErrorException({
        code: ErrorCode.POOL_RATES_FETCH_FAILED,
      });
    }

    return (data ?? []) as PoolRateHistoryEntryDto[];
  }

  async recordRates(): Promise<RecordRatesResponseDto> {
    const network = {
      rpc: this.stellar.getSafeRpcUrl(),
      passphrase: this.stellar.getNetworkPassphrase(),
    };
    const stellarNetwork = this.stellar.getNetwork();
    const blendPoolIds = getBlendPoolIds(stellarNetwork);

    const blendResults = await Promise.allSettled(
      blendPoolIds.map((id) => new BlendPoolAdapter(id, network).fetchRates())
    );
    const aquaResult = await Promise.allSettled([
      new AquaPoolAdapter().fetchRates(),
    ]);

    const rows: PoolRateRow[] = [];
    for (const result of blendResults) {
      if (result.status === "fulfilled") rows.push(...result.value);
    }
    if (aquaResult[0].status === "fulfilled") rows.push(...aquaResult[0].value);

    const filtered = rows.filter(
      (r) => r.supply_apy > 0 || (r.borrow_apy ?? 0) > 0
    );

    if (filtered.length === 0) {
      this.logger.warn("recordRates: no pools with non-zero APY found");
      return { inserted: 0 };
    }

    const { error } = await this.supabase.client
      .from("pool_rate_history")
      .insert(filtered);

    if (error) {
      this.logger.error("Failed to insert pool rate history", error);
      throw new InternalServerErrorException({
        code: ErrorCode.POOL_RATES_INSERT_FAILED,
      });
    }

    this.logger.log(`recordRates: inserted ${filtered.length} rows`);
    return { inserted: filtered.length };
  }
}
