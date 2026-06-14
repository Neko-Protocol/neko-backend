import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminAuthService } from "./admin-auth.service";
import { VerifyPasswordDto } from "./dto/verify-password.dto";
import { VerifyTotpDto } from "./dto/verify-totp.dto";

@ApiTags("admin/auth")
@Controller("admin/auth")
export class AdminAuthController {
  constructor(private readonly svc: AdminAuthService) {}

  @Post("verify-password")
  @ApiOperation({ summary: "Step 1 — verify admin email + password." })
  verifyPassword(@Body() body: VerifyPasswordDto) {
    return this.svc.verifyPassword(body.email, body.password);
  }

  @Post("verify-totp")
  @ApiOperation({ summary: "Step 2 — verify admin TOTP code." })
  verifyTotp(@Body() body: VerifyTotpDto) {
    return this.svc.verifyTotp(body.email, body.code);
  }

  @Get("totp-setup")
  @ApiOperation({ summary: "Generate a TOTP secret + QR for provisioning." })
  totpSetup(@Query("email") email?: string) {
    const trimmed = (email ?? "").trim();
    if (!trimmed) throw new BadRequestException({ code: "EMAIL_REQUIRED" });
    return this.svc.getTotpSetup(trimmed);
  }

  @Get("admins")
  @ApiOperation({ summary: "List active admin emails." })
  admins() {
    return this.svc.listAdminEmails();
  }
}
