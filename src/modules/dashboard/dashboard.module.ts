import { Module } from "@nestjs/common";
import { AssetPricesModule } from "../asset-prices/asset-prices.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { DashboardCache } from "./cache/dashboard-cache";

@Module({
  imports: [AssetPricesModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardCache],
})
export class DashboardModule {}
