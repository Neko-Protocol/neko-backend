import { Module } from "@nestjs/common";
import { CacheModule } from "./cache/cache.module";
import { DiditModule } from "./didit/didit.module";
import { EmailModule } from "./email/email.module";
import { HealthModule } from "./health/health.module";
import { ObservabilityModule } from "./observability/observability.module";
import { OrchestratorModule } from "./orchestrator/orchestrator.module";
import { PrivyModule } from "./privy/privy.module";
import { RpcModule } from "./rpc/rpc.module";
import { StellarModule } from "./stellar/stellar.module";
import { SupabaseModule } from "./supabase/supabase.module";

@Module({
  imports: [
    ObservabilityModule,
    CacheModule,
    RpcModule,
    StellarModule,
    SupabaseModule,
    PrivyModule,
    DiditModule,
    OrchestratorModule,
    EmailModule,
    HealthModule,
  ],
})
export class CoreModule {}
