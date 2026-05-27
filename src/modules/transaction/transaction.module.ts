import { Module } from "@nestjs/common";
import { TransactionController } from "./transaction.controller";
import { TransactionService } from "./transaction.service";
import { PreparedTxCache } from "./prepared-tx-cache";
import { XdrValidator } from "./xdr-validator";
import { SorobanErrorMapper } from "./errors/soroban-error.mapper";

@Module({
  controllers: [TransactionController],
  providers: [
    TransactionService,
    XdrValidator,
    SorobanErrorMapper,
    {
      provide: PreparedTxCache,
      useFactory: () => new PreparedTxCache(),
    },
  ],
})
export class TransactionModule {}
