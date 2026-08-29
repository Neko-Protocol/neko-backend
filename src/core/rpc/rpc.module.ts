import { Global, Module } from "@nestjs/common";
import { RpcClientService } from "./rpc-client.service";
import { RpcHealthScheduler } from "./rpc-health.scheduler";
import { RpcPoolService } from "./rpc-pool.service";

@Global()
@Module({
  providers: [RpcPoolService, RpcClientService, RpcHealthScheduler],
  exports: [RpcPoolService, RpcClientService],
})
export class RpcModule {}
