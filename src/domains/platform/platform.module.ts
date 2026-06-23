import { Module } from "@nestjs/common";
import { ActivationsModule } from "./activations/activations.module";
import { AuditModule } from "./audit/audit.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { ReferralsModule } from "./referrals/referrals.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    UsersModule,
    DashboardModule,
    ReferralsModule,
    ActivationsModule,
    AuditModule,
  ],
})
export class PlatformModule {}
