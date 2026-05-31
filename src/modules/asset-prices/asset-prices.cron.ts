import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { AssetPricesService } from "./asset-prices.service";

@Injectable()
export class AssetPricesCron {
  private readonly logger = new Logger(AssetPricesCron.name);

  constructor(private readonly svc: AssetPricesService) {}

  // Every 30 minutes — minute 0 and 30 of each hour
  @Cron("*/30 * * * *", { name: "asset-prices-every-30min" })
  async run(): Promise<void> {
    try {
      const { inserted } = await this.svc.recordOnce();
      this.logger.log(`asset-prices run completed (inserted=${inserted})`);
    } catch (err) {
      this.logger.error(`asset-prices run failed: ${(err as Error).message}`);
    }
  }
}
