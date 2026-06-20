import { Module } from "@nestjs/common";
import { VaultApyController } from "./vault-apy.controller";
import { VaultApyService } from "./vault-apy.service";

@Module({
  controllers: [VaultApyController],
  providers: [VaultApyService],
})
export class VaultApyModule {}
