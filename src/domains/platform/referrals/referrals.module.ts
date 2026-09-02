import { Module } from "@nestjs/common";
import { NotificationsCoreModule } from "@domains/platform/notifications/notifications-core.module";
import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { ReferralWalletVolumeCron } from "./referral-wallet-volume.cron";
import { ReferralsController } from "./referrals.controller";
import { ReferralsService } from "./referrals.service";

@Module({
  imports: [AdminAuthModule, NotificationsCoreModule],
  controllers: [ReferralsController],
  providers: [ReferralsService, ReferralWalletVolumeCron],
  exports: [ReferralsService],
})
export class ReferralsModule {}
