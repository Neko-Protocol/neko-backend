import { Global, Module } from "@nestjs/common";
import { RpcCacheService } from "./rpc-cache.service";
import { RpcClientService } from "./rpc-client.service";
import { RpcHealthScheduler } from "./rpc-health.scheduler";
import { RpcMetricsController } from "./rpc-metrics.controller";
import { RpcMetricsService } from "./rpc-metrics.service";
import { RpcPoolService } from "./rpc-pool.service";

@Global()
@Module({
  controllers: [RpcMetricsController],
  providers: [
    RpcPoolService,
    RpcCacheService,
    RpcClientService,
    RpcHealthScheduler,
    RpcMetricsService,
  ],
  exports: [
    RpcPoolService,
    RpcClientService,
    RpcCacheService,
    RpcMetricsService,
  ],
})
export class RpcModule {}
