import { Module } from "@nestjs/common";
import { AdminWalletBalanceService } from "./admin-wallet-balance.service";

// StellarModule is @Global, so StellarRpcService needs no explicit import here.
@Module({
  providers: [AdminWalletBalanceService],
  exports: [AdminWalletBalanceService],
})
export class AdminWalletBalanceModule {}
