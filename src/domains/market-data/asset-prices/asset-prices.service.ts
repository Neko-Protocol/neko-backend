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
import { RedisCacheService } from "@core/cache/redis-cache.service";
import { STELLAR_PRICE_SERVICE } from "./asset-prices.tokens";

export interface RecordPricesResult {
  inserted: number;
}

export interface SpotPrice {
  price: number;
  source: string | null;
}

export interface AssetPriceHistoryRow {
  price: number | string | null;
  source: string | null;
  recorded_at: string;
}

/**
 * How long a spot price is served without going upstream.
 *
 * This is what turns the cost of pricing from "users times assets" into
 * "assets times TTL": every visitor used to make their own call per asset, so
 * the free CoinGecko tier saw a burst on each page load. One minute matches
 * the in-process TTL StellarPriceService already applies and is no staler
 * than what the browser tolerated before.
 */
const SPOT_TTL_MS = 60_000;

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
    private readonly cache: RedisCacheService,
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

  /**
   * Current price for each requested symbol, cached in Redis.
   *
   * A symbol we do not have configured resolves to a zero price rather than an
   * error: the caller asked for a batch, and one unknown code should not cost
   * it the prices it can have.
   *
   * A failed lookup is cached too. It reads as "no price for now", which is
   * the point — when CoinGecko rate-limits us, retrying on every request is
   * how we stay rate-limited.
   */
  async getSpotPrices(symbols: string[]): Promise<Record<string, SpotPrice>> {
    const assets = getAssetsConfig(this.networkId);

    const entries = await Promise.all(
      symbols.map(async (symbol): Promise<[string, SpotPrice]> => {
        const asset = assets[symbol];
        if (!asset) return [symbol, { price: 0, source: null }];

        try {
          const { value } = await this.cache.through<SpotPrice>(
            `asset-price:${this.networkId}:${symbol}`,
            SPOT_TTL_MS,
            async () => {
              const { price, source } =
                await this.priceService.getPriceWithSource(
                  asset.code,
                  asset.contract
                );
              return { price, source: source ?? null };
            }
          );
          return [symbol, value];
        } catch (err) {
          // The chain already swallows per-source failures, so reaching here
          // means something unexpected. Report the symbol as unpriced rather
          // than failing the whole batch.
          this.logger.warn(
            `[asset-prices] spot ${symbol} failed: ${(err as Error).message}`
          );
          return [symbol, { price: 0, source: null }];
        }
      })
    );

    return Object.fromEntries(entries);
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
