import { Module } from "@nestjs/common";
import { AssetPricesModule } from "../asset-prices/asset-prices.module";
import { DefindexController } from "./defindex.controller";
import { DefindexService } from "./defindex.service";

@Module({
  imports: [AssetPricesModule],
  controllers: [DefindexController],
  providers: [DefindexService],
  exports: [DefindexService],
})
export class DefindexModule {}
