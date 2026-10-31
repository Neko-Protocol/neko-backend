import { Global, Module } from "@nestjs/common";
import { PrivyService } from "./privy.service";

@Global()
@Module({
  providers: [PrivyService],
  exports: [PrivyService],
})
export class PrivyModule {}
