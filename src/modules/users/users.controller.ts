import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import {
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { UserPublic } from "@neko/api-contracts";
import { EmailConfirmDto } from "./dto/email-confirm.dto";
import { EmailStartDto } from "./dto/email-start.dto";
import { RegisterUserDto } from "./dto/register-user.dto";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";
import { UsersService } from "./users.service";

@ApiTags("users")
@ApiTooManyRequestsResponse({ description: "Rate-limited." })
@Controller({ path: "users", version: VERSION_NEUTRAL })
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Register wallet connect (fire-and-forget upsert).",
  })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  register(@Body() dto: RegisterUserDto) {
    return this.svc.register(dto);
  }

  @Get()
  @ApiOperation({ summary: "Get public user profile by wallet query param." })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  get(@Query("wallet") wallet?: string): Promise<UserPublic | null> {
    return this.svc.get((wallet ?? "").trim());
  }

  @Post("preferences")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Merge partial user preferences for a wallet." })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  updatePreferences(@Body() dto: UpdatePreferencesDto) {
    return this.svc.updatePreferences(dto);
  }

  @Post("email/start")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Start email verification (magic link OTP)." })
  @Throttle({
    short: { limit: 5, ttl: 60_000 },
    default: { limit: 10, ttl: 60_000 },
  })
  startEmail(@Body() dto: EmailStartDto) {
    return this.svc.startEmailVerification(dto);
  }

  @Post("email/confirm")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Confirm email using Supabase access_token from redirect.",
  })
  @Throttle({
    short: { limit: 5, ttl: 60_000 },
    default: { limit: 10, ttl: 60_000 },
  })
  confirmEmail(@Body() dto: EmailConfirmDto) {
    return this.svc.confirmEmail(dto);
  }
}
