import { Module } from "@nestjs/common";
import { VaultInvestController } from "./vault-invest.controller";
import { VaultInvestCron } from "./vault-invest.cron";
import { VaultInvestService } from "./vault-invest.service";

@Module({
  controllers: [VaultInvestController],
  providers: [VaultInvestService, VaultInvestCron],
  exports: [VaultInvestService],
})
export class VaultInvestModule {}
