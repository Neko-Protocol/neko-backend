import { Global, Module } from "@nestjs/common";
import { SponsorService } from "./sponsor.service";
import { StellarRpcService } from "./stellar-rpc.service";
import { TrustlineResolver } from "./trustline-resolver";

@Global()
@Module({
  providers: [StellarRpcService, SponsorService, TrustlineResolver],
  exports: [StellarRpcService, SponsorService, TrustlineResolver],
})
export class StellarModule {}
