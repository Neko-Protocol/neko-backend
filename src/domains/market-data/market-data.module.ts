import { Module } from "@nestjs/common";
import { AssetPricesModule } from "./asset-prices/asset-prices.module";
import { ContractActivityModule } from "./contract-activity/contract-activity.module";
import { EtherfuseModule } from "./etherfuse/etherfuse.module";
import { PoolRatesModule } from "./pool-rates/pool-rates.module";

@Module({
  imports: [
    AssetPricesModule,
    PoolRatesModule,
    EtherfuseModule,
    ContractActivityModule,
  ],
  // Re-exported so investing (defindex) and platform (dashboard) can inject
  // the STELLAR_PRICE_SERVICE token across the context boundary.
  exports: [AssetPricesModule],
})
export class MarketDataModule {}
