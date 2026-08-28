import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AdminAuthService } from "./admin-auth.service";
import { RequestCodeDto } from "./dto/request-code.dto";
import { VerifyCodeDto } from "./dto/verify-code.dto";

@ApiTags("admin-auth")
@Controller("admin-auth")
export class AdminAuthController {
  constructor(private readonly svc: AdminAuthService) {}

  @Post("request-code")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Send a one-time sign-in code to an authorized admin email.",
  })
  @Throttle({
    short: { limit: 5, ttl: 60_000 },
    default: { limit: 10, ttl: 60_000 },
  })
  requestCode(@Body() dto: RequestCodeDto) {
    return this.svc.requestCode(dto.email);
  }

  @Post("verify-code")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Verify a one-time sign-in code and mint a Supabase session token hash.",
  })
  @Throttle({
    short: { limit: 5, ttl: 60_000 },
    default: { limit: 10, ttl: 60_000 },
  })
  verifyCode(@Body() dto: VerifyCodeDto) {
    return this.svc.verifyCode(dto.email, dto.code);
  }
}
