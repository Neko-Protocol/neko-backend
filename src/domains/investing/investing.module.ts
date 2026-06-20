import { Module } from "@nestjs/common";
import { DefindexModule } from "./defindex/defindex.module";
import { RecommendedStrategiesModule } from "./recommended-strategies/recommended-strategies.module";
import { StrategyCatalogModule } from "./strategy-catalog/strategy-catalog.module";
import { VaultApyModule } from "./vault-apy/vault-apy.module";
import { VaultInvestModule } from "./vault-invest/vault-invest.module";
import { VaultPpsModule } from "./vault-pps/vault-pps.module";

@Module({
  imports: [
    VaultInvestModule,
    VaultPpsModule,
    VaultApyModule,
    StrategyCatalogModule,
    RecommendedStrategiesModule,
    DefindexModule,
  ],
})
export class InvestingModule {}
