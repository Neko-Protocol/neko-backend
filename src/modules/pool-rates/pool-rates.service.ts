import { Injectable, Logger } from "@nestjs/common";
import { OrchestratorService } from "../orchestrator/orchestrator.service";
import { SupabaseService } from "../supabase/supabase.service";

export interface RecordRatesResult {
  inserted: number;
}

@Injectable()
export class PoolRatesService {
  private readonly logger = new Logger(PoolRatesService.name);

  constructor(
    private readonly orch: OrchestratorService,
    private readonly supabase: SupabaseService
  ) {}

  async recordOnce(): Promise<RecordRatesResult> {
    const pools = await this.orch.orchestrator.getAllPools();
    const rows = pools
      .filter(
        (p) =>
          (p.apy ?? 0) > 0 ||
          (((p.metadata?.borrowApy as number | undefined) ?? 0) as number) > 0
      )
      .map((p) => ({
        pool_id: p.id,
        supply_apy: p.apy ?? 0,
        borrow_apy:
          (p.metadata?.borrowApy as number | undefined) ??
          (null as unknown as number),
      }));

    if (rows.length === 0) {
      this.logger.log("[pool-rates] nothing to insert");
      return { inserted: 0 };
    }

    const { error } = await this.supabase.client
      .from("pool_rate_history")
      .insert(rows);

    if (error) {
      this.logger.error(`[pool-rates] insert failed: ${error.message}`);
      throw new Error(error.message);
    }

    this.logger.log(`[pool-rates] inserted ${rows.length} rows`);
    return { inserted: rows.length };
  }
}
