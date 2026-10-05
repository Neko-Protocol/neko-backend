import { Module } from "@nestjs/common";
import { DashboardCacheModule } from "@domains/platform/dashboard/cache/dashboard-cache.module";
import { TransactionController } from "./transaction.controller";
import { TransactionService } from "./transaction.service";
import { PreparedTxCache } from "./cache/prepared-tx-cache";
import { XdrValidator } from "./validation/xdr-validator";
import { SorobanErrorMapper } from "./errors/soroban-error.mapper";

@Module({
  imports: [DashboardCacheModule],
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
  exports: [TransactionService],
})
export class TransactionModule {}
