import { Module } from "@nestjs/common";
import { NotificationsCoreModule } from "@domains/platform/notifications/notifications-core.module";
import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { ReferralsController } from "./referrals.controller";
import { ReferralsService } from "./referrals.service";

@Module({
  imports: [AdminAuthModule, NotificationsCoreModule],
  controllers: [ReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
