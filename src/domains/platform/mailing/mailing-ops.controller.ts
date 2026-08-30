import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { MailingAudiencesService } from "./audiences/mailing-audiences.service";
import { isAudienceId } from "./audiences/mailing-audiences.types";
import { MailingEnrollmentService } from "./enrollment/mailing-enrollment.service";
import { MailingDispatchService } from "./dispatch/mailing-dispatch.service";
import { PreviewEmailDto } from "./dto/preview-email.dto";
import { MailingStatsService } from "./stats/mailing-stats.service";
import { renderEmailHtml } from "./email-render";

const PREVIEW_EMAIL = "recipient@example.com";
const PREVIEW_WALLET =
  "GAPNNM2YZ5KP7FCX7ENELRUEU7JZRS5ZRWWXXYYA3S6GQXXUML7HZ63M";
const PREVIEW_UNSUBSCRIBE_URL = "https://dapp.nekoprotocol.xyz/api/unsubscribe";

@ApiTags("admin/mailing/ops")
@Controller("admin/mailing")
export class MailingOpsController {
  constructor(
    private readonly enrollment: MailingEnrollmentService,
    private readonly dispatch: MailingDispatchService,
    private readonly audiences: MailingAudiencesService,
    private readonly stats: MailingStatsService
  ) {}

  @Get("stats")
  @ApiOperation({ summary: "Aggregate mailing delivery statistics." })
  getStats() {
    return this.stats.get();
  }

  @Get("audience-preview")
  @ApiOperation({
    summary: "Live recipient count for an audience (opt-outs excluded).",
  })
  async audiencePreview(@Query("audience") audience?: string) {
    const id = typeof audience === "string" ? audience : "all";
    if (!isAudienceId(id)) {
      throw new BadRequestException({ code: "INVALID_AUDIENCE" });
    }
    const recipients = await this.audiences.getSendableRecipients(id);
    return { audience: id, count: recipients.length };
  }

  @Post("preview")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Render body content inside the branded shell, exactly as it will send.",
  })
  preview(@Body() body: PreviewEmailDto) {
    return {
      html: renderEmailHtml({
        bodyHtml: body.body_html,
        email: body.email ?? PREVIEW_EMAIL,
        walletAddress: body.wallet_address ?? PREVIEW_WALLET,
        // Always populated in previews so the admin can see the unsubscribe
        // control even when MAILING_UNSUBSCRIBE_SECRET isn't set locally.
        unsubscribeUrl: PREVIEW_UNSUBSCRIBE_URL,
      }),
    };
  }

  @Post("run-enrollment")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: "Manually trigger the mailing-enrollment job (QA/ops only).",
  })
  runEnrollment() {
    return this.enrollment.run();
  }

  @Post("run-dispatch")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: "Manually trigger the mailing-dispatch job (QA/ops only).",
  })
  runDispatch() {
    return this.dispatch.run();
  }
}
