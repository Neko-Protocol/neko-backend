import { Module } from "@nestjs/common";
import { PoolRatesController } from "./pool-rates.controller";
import { PoolRatesService } from "./pool-rates.service";

@Module({
  controllers: [PoolRatesController],
  providers: [PoolRatesService],
})
export class PoolRatesModule {}
