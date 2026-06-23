import { Module } from "@nestjs/common";
import { VaultPpsController } from "./vault-pps.controller";
import { VaultPpsCron } from "./vault-pps.cron";
import { VaultPpsService } from "./vault-pps.service";

@Module({
  controllers: [VaultPpsController],
  providers: [VaultPpsService, VaultPpsCron],
  exports: [VaultPpsService],
})
export class VaultPpsModule {}
