import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ErrorCode } from "@neko/api-contracts";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard";
import { ClaimReferralDto } from "./dto/claim-referral.dto";
import { ReferralsService } from "./referrals.service";

@ApiTags("referrals")
@ApiTooManyRequestsResponse({ description: "Rate-limited." })
@Controller("referrals")
export class ReferralsController {
  constructor(private readonly svc: ReferralsService) {}

  private requireWallet(wallet?: string): string {
    const trimmed = (wallet ?? "").trim();
    if (!trimmed) {
      throw new BadRequestException({ code: ErrorCode.WALLET_REQUIRED });
    }
    return trimmed;
  }

  @Get("code")
  @ApiOperation({
    summary: "Get (or lazily create) the wallet's referral code.",
  })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getCode(@Query("wallet") wallet?: string) {
    return this.svc.getOrCreateCode(this.requireWallet(wallet));
  }

  @Get("me")
  @ApiOperation({
    summary: "Referral code + confirmed referrals + volume for a wallet.",
  })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getMe(@Query("wallet") wallet?: string) {
    return this.svc.getMe(this.requireWallet(wallet));
  }

  @Post("claim")
  @ApiOperation({
    summary:
      "Attach a referral code to an already-registered wallet that wasn't attributed yet.",
  })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  claim(@Body() body: ClaimReferralDto) {
    return this.svc.claim(this.requireWallet(body.wallet_address), body.code);
  }

  @Get("referred")
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List users referred by a given wallet (admin)." })
  @ApiUnauthorizedResponse({ description: "Missing or invalid admin session." })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getReferred(@Query("wallet") wallet?: string) {
    return this.svc.getReferred(this.requireWallet(wallet));
  }

  @Get("leaderboard")
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Referrers ranked by referred volume (admin)." })
  @ApiUnauthorizedResponse({ description: "Missing or invalid admin session." })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getLeaderboard() {
    return this.svc.getLeaderboard();
  }

  @Get("leaderboard/partners")
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Companies/influencers ranked by referred volume (admin).",
  })
  @ApiUnauthorizedResponse({ description: "Missing or invalid admin session." })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getPartnerLeaderboard() {
    return this.svc.getPartnerLeaderboard();
  }
}
