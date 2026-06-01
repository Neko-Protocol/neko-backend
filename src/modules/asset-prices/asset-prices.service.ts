import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  getAssetsConfig,
  getCurrentNetworkId,
  type AssetConfig,
  type NetworkId,
  type StellarPriceService,
} from "@neko/keeper";
import { SupabaseService } from "../supabase/supabase.service";
import { STELLAR_PRICE_SERVICE } from "./asset-prices.tokens";

export interface RecordPricesResult {
  inserted: number;
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
}
