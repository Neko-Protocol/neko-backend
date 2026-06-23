import { Module } from "@nestjs/common";
import { AdminAuthModule } from "./admin-auth/admin-auth.module";
import { AdminDashboardModule } from "./admin-dashboard/admin-dashboard.module";
import { AdminStrategiesModule } from "./admin-strategies/admin-strategies.module";
import { CampaignsModule } from "./campaigns/campaigns.module";
import { InvitationsModule } from "./invitations/invitations.module";
import { SegmentsModule } from "./segments/segments.module";

@Module({
  imports: [
    AdminAuthModule,
    AdminDashboardModule,
    AdminStrategiesModule,
    CampaignsModule,
    InvitationsModule,
    SegmentsModule,
  ],
})
export class AdminModule {}
