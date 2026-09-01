import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { CreateReferralPartnerDto } from "./dto/create-referral-partner.dto";
import { UpdateReferralPartnerDto } from "./dto/update-referral-partner.dto";
import { ReferralPartnersService } from "./referral-partners.service";

@ApiTags("admin/referral-partners")
@Controller("admin/referral-partners")
export class ReferralPartnersController {
  constructor(private readonly svc: ReferralPartnersService) {}

  @Get()
  @ApiOperation({ summary: "List referral codes created for partners." })
  list() {
    return this.svc.list();
  }

  @Post()
  @ApiOperation({
    summary: "Create a referral code for a company or influencer.",
  })
  create(@Body() body: CreateReferralPartnerDto) {
    return this.svc.create(body);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Activate or deactivate a partner's code." })
  setActive(@Param("id") id: string, @Body() body: UpdateReferralPartnerDto) {
    return this.svc.setActive(id, body.is_active);
  }
}
