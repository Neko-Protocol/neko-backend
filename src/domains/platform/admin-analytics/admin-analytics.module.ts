import { Module } from "@nestjs/common";
import { DefindexModule } from "@domains/investing/defindex/defindex.module";
import { DashboardModule } from "@domains/platform/dashboard/dashboard.module";
import { InfrastructureService } from "./infrastructure.service";
import { AdminAnalyticsController } from "./admin-analytics.controller";
import { AdminStatsService } from "./admin-stats.service";
import { AdminVaultReportingService } from "./admin-vault-reporting.service";

@Module({
  imports: [DefindexModule, DashboardModule],
  controllers: [AdminAnalyticsController],
  providers: [
    InfrastructureService,
    AdminStatsService,
    AdminVaultReportingService,
  ],
})
export class AdminAnalyticsModule {}
