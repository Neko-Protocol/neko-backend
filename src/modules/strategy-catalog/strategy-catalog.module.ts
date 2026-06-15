import { Module } from "@nestjs/common";
import { DefindexModule } from "../defindex/defindex.module";
import { StrategyCatalogController } from "./strategy-catalog.controller";
import { StrategyCatalogCron } from "./strategy-catalog.cron";
import { StrategyCatalogService } from "./strategy-catalog.service";

@Module({
  imports: [DefindexModule],
  controllers: [StrategyCatalogController],
  providers: [StrategyCatalogService, StrategyCatalogCron],
  exports: [StrategyCatalogService],
})
export class StrategyCatalogModule {}
