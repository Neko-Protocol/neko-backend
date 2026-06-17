import { Module } from "@nestjs/common";
import { ContractActivityController } from "./contract-activity.controller";
import { ContractActivityService } from "./contract-activity.service";

@Module({
  controllers: [ContractActivityController],
  providers: [ContractActivityService],
})
export class ContractActivityModule {}
