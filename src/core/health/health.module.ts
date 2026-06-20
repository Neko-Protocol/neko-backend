import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { HealthController } from "./health.controller";
import { SorobanRpcHealthIndicator } from "./indicators/soroban-rpc.health";
import { HorizonHealthIndicator } from "./indicators/horizon.health";

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [SorobanRpcHealthIndicator, HorizonHealthIndicator],
})
export class HealthModule {}
