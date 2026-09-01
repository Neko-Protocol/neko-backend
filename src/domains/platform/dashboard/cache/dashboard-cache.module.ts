import { Module } from "@nestjs/common";
import { DashboardCache } from "./dashboard-cache";

/**
 * The dashboard's read cache on its own, with nothing but Redis behind it.
 *
 * Split out so a domain that invalidates a wallet's entry — the transaction
 * submitter, once a wallet has moved funds — can import just the cache instead
 * of DashboardModule, which would drag the orchestrator and the price service
 * in with it.
 */
@Module({
  providers: [DashboardCache],
  exports: [DashboardCache],
})
export class DashboardCacheModule {}
