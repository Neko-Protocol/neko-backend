import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import { SkipAuth } from "@common/decorators/skip-auth.decorator";
import { DiditService } from "@core/didit/didit.service";
import type { DiditWebhookPayload } from "@core/didit/didit.types";
import { LaunchpadErrorCode } from "./launchpad.types";
import { VerificationsService } from "./verifications.service";

/** Didit calls this directly, so it skips the internal-key guard and authenticates by HMAC instead. */
@ApiExcludeController()
@Controller("launchpad/webhooks")
export class DiditWebhookController {
  constructor(
    private readonly didit: DiditService,
    private readonly verifications: VerificationsService
  ) {}

  @Post("didit")
  @SkipAuth()
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: DiditWebhookPayload
  ): Promise<{ ok: true }> {
    if (!this.didit.verifyWebhook(req.rawBody, req.headers)) {
      throw new UnauthorizedException({
        code: LaunchpadErrorCode.WEBHOOK_SIGNATURE_INVALID,
      });
    }
    await this.verifications.handleWebhook(payload);
    return { ok: true };
  }
}
