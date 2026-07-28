import { Controller, HttpCode, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { MailingEnrollmentService } from "./enrollment/mailing-enrollment.service";
import { MailingDispatchService } from "./dispatch/mailing-dispatch.service";

@ApiTags("admin/mailing/ops")
@Controller("admin/mailing")
export class MailingOpsController {
  constructor(
    private readonly enrollment: MailingEnrollmentService,
    private readonly dispatch: MailingDispatchService
  ) {}

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
