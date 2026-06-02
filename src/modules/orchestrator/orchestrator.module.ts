import { Global, Module } from "@nestjs/common";
import { OrchestratorService } from "./orchestrator.service";

@Global()
@Module({
  providers: [OrchestratorService],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
