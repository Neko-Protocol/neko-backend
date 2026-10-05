import { Global, Module } from "@nestjs/common";
import { SponsorService } from "./sponsor.service";
import { StellarRpcService } from "./stellar-rpc.service";

@Global()
@Module({
  providers: [StellarRpcService, SponsorService],
  exports: [StellarRpcService, SponsorService],
})
export class StellarModule {}
