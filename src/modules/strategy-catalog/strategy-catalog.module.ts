import { Module } from "@nestjs/common";
import { StrategyCatalogController } from "./strategy-catalog.controller";
import { StrategyCatalogCron } from "./strategy-catalog.cron";
import { StrategyCatalogService } from "./strategy-catalog.service";

@Module({
  controllers: [StrategyCatalogController],
  providers: [StrategyCatalogService, StrategyCatalogCron],
  exports: [StrategyCatalogService],
})
export class StrategyCatalogModule {}
