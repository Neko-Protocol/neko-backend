import { Module } from "@nestjs/common";
import { TransactionModule } from "@domains/chain/transaction/transaction.module";
import { AccountsController } from "./accounts.controller";
import { AccountsService } from "./accounts.service";
import { WalletActivationService } from "./wallet-activation.service";

@Module({
  imports: [TransactionModule],
  controllers: [AccountsController],
  providers: [AccountsService, WalletActivationService],
  exports: [AccountsService],
})
export class AccountsModule {}
