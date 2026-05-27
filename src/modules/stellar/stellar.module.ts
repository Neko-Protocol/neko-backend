import { Global, Module } from "@nestjs/common";
import { StellarRpcService } from "./stellar-rpc.service";

@Global()
@Module({
  providers: [StellarRpcService],
  exports: [StellarRpcService],
})
export class StellarModule {}
