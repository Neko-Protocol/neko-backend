import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  getAssetsConfig,
  getCurrentNetworkId,
  type AssetConfig,
  type NetworkId,
  type StellarPriceService,
} from "@neko/keeper";
import { SupabaseService } from "@core/supabase/supabase.service";
import { STELLAR_PRICE_SERVICE } from "./asset-prices.tokens";

export interface RecordPricesResult {
  inserted: number;
}

export interface AssetPriceHistoryRow {
  price: number | string | null;
  source: string | null;
  recorded_at: string;
}

const HISTORY_WINDOW_DAYS = 30;
const HISTORY_ROW_LIMIT = 10_000;

function collapseToHourlySamples(
  newestFirst: AssetPriceHistoryRow[]
): AssetPriceHistoryRow[] {
  const seenHours = new Set<string>();
  const kept: AssetPriceHistoryRow[] = [];

  for (const row of newestFirst) {
    const hour = row.recorded_at.slice(0, 13);
    if (seenHours.has(hour)) continue;
    seenHours.add(hour);
    kept.push(row);
  }

  return kept.reverse();
}

@Injectable()
export class AssetPricesService {
  private readonly logger = new Logger(AssetPricesService.name);
  private readonly networkId: NetworkId;

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
    @Inject(STELLAR_PRICE_SERVICE)
    private readonly priceService: StellarPriceService
  ) {
    const stellarNetworkRaw =
      this.config.get<string>("STELLAR_NETWORK") ?? "mainnet";
    this.networkId = getCurrentNetworkId(stellarNetworkRaw);
  }

  async recordOnce(): Promise<RecordPricesResult> {
    const assets = Object.values(getAssetsConfig(this.networkId));
    const results = await Promise.all(
      assets.map(async (asset: AssetConfig) => {
        try {
          const { price, source } = await this.priceService.getPriceWithSource(
            asset.code,
            asset.contract
          );
          return { symbol: asset.code, price, source };
        } catch (err) {
          this.logger.warn(
            `[asset-prices] ${asset.code} fetch failed: ${(err as Error).message}`
          );
          return null;
        }
      })
    );

    const rows = results.filter(
      (r): r is NonNullable<typeof r> => r !== null && r.price > 0
    );

    if (rows.length === 0) {
      this.logger.log("[asset-prices] nothing to insert");
      return { inserted: 0 };
    }

    const { error } = await this.supabase.client
      .from("asset_price_history")
      .insert(rows);
    if (error) {
      this.logger.error(`[asset-prices] insert failed: ${error.message}`);
      throw new Error(error.message);
    }

    this.logger.log(`[asset-prices] inserted ${rows.length} rows`);
    return { inserted: rows.length };
  }

  async getHistory(symbol: string): Promise<AssetPriceHistoryRow[]> {
    const since = new Date(
      Date.now() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const { data, error } = await this.supabase.client
      .from("asset_price_history")
      .select("price, source, recorded_at")
      .eq("symbol", symbol.toUpperCase())
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: false })
      .limit(HISTORY_ROW_LIMIT);

    if (error) {
      this.logger.error(`[asset-prices] history failed: ${error.message}`);
      throw new Error(error.message);
    }

    return collapseToHourlySamples((data ?? []) as AssetPriceHistoryRow[]);
  }
}
