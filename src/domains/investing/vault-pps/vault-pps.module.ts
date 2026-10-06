import { Module } from "@nestjs/common";
import { NotificationsCoreModule } from "@domains/platform/notifications/notifications-core.module";
import { VaultPpsController } from "./vault-pps.controller";
import { VaultPpsCron } from "./vault-pps.cron";
import { VaultPpsService } from "./vault-pps.service";

@Module({
  imports: [NotificationsCoreModule],
  controllers: [VaultPpsController],
  providers: [VaultPpsService, VaultPpsCron],
  exports: [VaultPpsService],
})
export class VaultPpsModule {}
