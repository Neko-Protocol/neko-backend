import { Module } from "@nestjs/common";
import { ReferralPartnersController } from "./referral-partners.controller";
import { ReferralPartnersService } from "./referral-partners.service";

@Module({
  controllers: [ReferralPartnersController],
  providers: [ReferralPartnersService],
  exports: [ReferralPartnersService],
})
export class ReferralPartnersModule {}
