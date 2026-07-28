import { Module } from "@nestjs/common";
import { AdminAuthModule } from "./admin-auth/admin-auth.module";
import { AdminDashboardModule } from "./admin-dashboard/admin-dashboard.module";
import { AdminStrategiesModule } from "./admin-strategies/admin-strategies.module";
import { CampaignsModule } from "./campaigns/campaigns.module";
import { InvitationsModule } from "./invitations/invitations.module";
import { MailingModule } from "./mailing/mailing.module";
import { SegmentsModule } from "./segments/segments.module";

@Module({
  imports: [
    AdminAuthModule,
    AdminDashboardModule,
    AdminStrategiesModule,
    CampaignsModule,
    InvitationsModule,
    MailingModule,
    SegmentsModule,
  ],
})
export class AdminModule {}
