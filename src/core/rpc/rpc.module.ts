import { Global, Module } from "@nestjs/common";
import { RpcCacheService } from "./rpc-cache.service";
import { RpcClientService } from "./rpc-client.service";
import { RpcHealthScheduler } from "./rpc-health.scheduler";
import { RpcPoolService } from "./rpc-pool.service";

@Global()
@Module({
  providers: [
    RpcPoolService,
    RpcCacheService,
    RpcClientService,
    RpcHealthScheduler,
  ],
  exports: [RpcPoolService, RpcClientService, RpcCacheService],
})
export class RpcModule {}
