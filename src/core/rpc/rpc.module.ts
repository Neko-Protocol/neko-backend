import { Global, Module } from "@nestjs/common";
import { RpcCacheService } from "./cache/rpc-cache.service";
import { RpcClientService } from "./client/rpc-client.service";
import { RpcMetricsService } from "./metrics/rpc-metrics.service";
import { RpcHealthScheduler } from "./pool/rpc-health.scheduler";
import { RpcPoolService } from "./pool/rpc-pool.service";

/**
 * The RPC gateway: endpoint pool, health checks, failover and retry, response
 * caching, and the collectors that measure all of it.
 *
 * Global because StellarRpcService and the domain modules consume it without
 * importing it explicitly.
 */
@Global()
@Module({
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
