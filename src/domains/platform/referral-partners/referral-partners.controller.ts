import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { CreateReferralPartnerDto } from "./dto/create-referral-partner.dto";
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

  @Delete(":id")
  @ApiOperation({
    summary:
      "Permanently delete a partner's referral code (cascades to their referral history).",
  })
  async remove(@Param("id") id: string) {
    await this.svc.remove(id);
    return { ok: true };
  }
}
