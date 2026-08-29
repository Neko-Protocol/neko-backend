import { Module } from "@nestjs/common";
import { EmailModule } from "./email/email.module";
import { HealthModule } from "./health/health.module";
import { OrchestratorModule } from "./orchestrator/orchestrator.module";
import { RpcModule } from "./rpc/rpc.module";
import { StellarModule } from "./stellar/stellar.module";
import { SupabaseModule } from "./supabase/supabase.module";

@Module({
  imports: [
    RpcModule,
    StellarModule,
    SupabaseModule,
    OrchestratorModule,
    EmailModule,
    HealthModule,
  ],
})
export class CoreModule {}
