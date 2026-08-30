import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";
import { AssetPricesController } from "./asset-prices.controller";
import { AssetPricesCron } from "./asset-prices.cron";
import { AssetPricesService } from "./asset-prices.service";
import { STELLAR_PRICE_SERVICE } from "./asset-prices.tokens";
import { createStellarPriceService } from "./stellar-price.factory";

@Module({
  controllers: [AssetPricesController],
  providers: [
    AssetPricesService,
    AssetPricesCron,
    {
      provide: STELLAR_PRICE_SERVICE,
      inject: [ConfigService, StellarRpcService],
      useFactory: (config: ConfigService, stellarRpc: StellarRpcService) =>
        createStellarPriceService(config, stellarRpc),
    },
  ],
  exports: [AssetPricesService, STELLAR_PRICE_SERVICE],
})
export class AssetPricesModule {}
