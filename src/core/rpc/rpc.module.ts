import { Global, Module } from "@nestjs/common";
import { RpcCacheService } from "./cache/rpc-cache.service";
import { RpcClientService } from "./client/rpc-client.service";
import { RpcForwarderService } from "./client/rpc-forwarder.service";
import { RpcMetricsService } from "./metrics/rpc-metrics.service";
import { RpcHealthScheduler } from "./pool/rpc-health.scheduler";
import { RpcPoolService } from "./pool/rpc-pool.service";
import { RpcController } from "./rpc.controller";

/**
 * The RPC gateway: endpoint pool, health checks, failover and retry, response
 * caching, the collectors that measure all of it, and the JSON-RPC passthrough
 * the browser talks to.
 *
 * Global because StellarRpcService and the domain modules consume it without
 * importing it explicitly.
 */
@Global()
@Module({
  controllers: [RpcController],
  providers: [
    RpcPoolService,
    RpcCacheService,
    RpcClientService,
    RpcForwarderService,
    RpcHealthScheduler,
    RpcMetricsService,
  ],
  exports: [
    RpcPoolService,
    RpcClientService,
    RpcForwarderService,
    RpcCacheService,
    RpcMetricsService,
  ],
})
export class RpcModule {}
