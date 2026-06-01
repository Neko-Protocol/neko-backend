import { Module } from "@nestjs/common";
import { PoolRatesController } from "./pool-rates.controller";
import { PoolRatesCron } from "./pool-rates.cron";
import { PoolRatesService } from "./pool-rates.service";

@Module({
  controllers: [PoolRatesController],
  providers: [PoolRatesService, PoolRatesCron],
  exports: [PoolRatesService],
})
export class PoolRatesModule {}
