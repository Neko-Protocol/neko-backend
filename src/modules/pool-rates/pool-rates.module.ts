import { Module } from "@nestjs/common";
import { PoolRatesService } from "./pool-rates.service";
import { PoolRatesCron } from "./pool-rates.cron";

@Module({
  providers: [PoolRatesService, PoolRatesCron],
  exports: [PoolRatesService],
})
export class PoolRatesModule {}
