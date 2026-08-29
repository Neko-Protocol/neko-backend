import { Module } from "@nestjs/common";
import { ActivationsModule } from "./activations/activations.module";
import { AdminAnalyticsModule } from "./admin-analytics/admin-analytics.module";
import { AdminAuthModule } from "./admin-auth/admin-auth.module";
import { AuditModule } from "./audit/audit.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { MailingModule } from "./mailing/mailing.module";
import { ReferralsModule } from "./referrals/referrals.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    UsersModule,
    DashboardModule,
    ReferralsModule,
    ActivationsModule,
    AuditModule,
    AdminAuthModule,
    AdminAnalyticsModule,
    MailingModule,
  ],
})
export class PlatformModule {}
