import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { UnsubscribeDto } from "./dto/unsubscribe.dto";
import { MailingUnsubscribeTokenService } from "./mailing-unsubscribe-token.service";
import { MailingUnsubscribeService } from "./mailing-unsubscribe.service";

@ApiTags("mailing")
@Controller("mailing")
export class MailingUnsubscribeController {
  constructor(
    private readonly tokenService: MailingUnsubscribeTokenService,
    private readonly optOuts: MailingUnsubscribeService
  ) {}

  @Post("unsubscribe")
  @ApiOperation({ summary: "Opt out of mailing automations via signed token." })
  async unsubscribe(@Body() body: UnsubscribeDto) {
    const walletAddress = this.tokenService.verify(body.token);
    if (walletAddress === null) {
      throw new BadRequestException({ code: "INVALID_TOKEN" });
    }
    await this.optOuts.recordOptOut(walletAddress);
    return { ok: true };
  }
}
