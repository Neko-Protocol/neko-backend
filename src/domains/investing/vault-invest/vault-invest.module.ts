import { Module } from "@nestjs/common";
import { NotificationsCoreModule } from "@domains/platform/notifications/notifications-core.module";
import { VaultInvestController } from "./vault-invest.controller";
import { VaultInvestCron } from "./vault-invest.cron";
import { VaultInvestService } from "./vault-invest.service";

@Module({
  imports: [NotificationsCoreModule],
  controllers: [VaultInvestController],
  providers: [VaultInvestService, VaultInvestCron],
  exports: [VaultInvestService],
})
export class VaultInvestModule {}
