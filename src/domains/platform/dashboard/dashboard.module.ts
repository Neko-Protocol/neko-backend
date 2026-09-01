import { Module } from "@nestjs/common";
import { AssetPricesModule } from "@domains/market-data/asset-prices/asset-prices.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { DashboardCacheModule } from "./cache/dashboard-cache.module";

@Module({
  imports: [AssetPricesModule, DashboardCacheModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
