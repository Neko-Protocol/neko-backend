import { Module } from "@nestjs/common";
import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { ReferralPartnersController } from "./referral-partners.controller";
import { ReferralPartnersService } from "./referral-partners.service";

@Module({
  imports: [AdminAuthModule],
  controllers: [ReferralPartnersController],
  providers: [ReferralPartnersService],
  exports: [ReferralPartnersService],
})
export class ReferralPartnersModule {}
