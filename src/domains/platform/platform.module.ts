import { Module } from "@nestjs/common";
import { AccountsModule } from "./accounts/accounts.module";
import { AdminAnalyticsModule } from "./admin-analytics/admin-analytics.module";
import { AdminAuthModule } from "./admin-auth/admin-auth.module";
import { AdminEmailsModule } from "./admin-emails/admin-emails.module";
import { AuditModule } from "./audit/audit.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { MailingModule } from "./mailing/mailing.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { ReferralPartnersModule } from "./referral-partners/referral-partners.module";
import { ReferralsModule } from "./referrals/referrals.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    UsersModule,
    AccountsModule,
    DashboardModule,
    ReferralsModule,
    ReferralPartnersModule,
    AuditModule,
    AdminAuthModule,
    AdminAnalyticsModule,
    AdminEmailsModule,
    MailingModule,
    NotificationsModule,
  ],
})
export class PlatformModule {}
