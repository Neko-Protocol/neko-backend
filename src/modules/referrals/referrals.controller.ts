import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import {
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ReferralsService } from "./referrals.service";

@ApiTags("referrals")
@ApiTooManyRequestsResponse({ description: "Rate-limited." })
@Controller("referrals")
export class ReferralsController {
  constructor(private readonly svc: ReferralsService) {}

  private requireWallet(wallet?: string): string {
    const trimmed = (wallet ?? "").trim();
    if (!trimmed) {
      throw new BadRequestException({ code: "WALLET_REQUIRED" });
    }
    return trimmed;
  }

  @Get("code")
  @ApiOperation({ summary: "Get (or lazily create) the wallet's referral code." })
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

  @Get("leaderboard")
  @ApiOperation({ summary: "Referrers ranked by referred volume (admin)." })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getLeaderboard() {
    return this.svc.getLeaderboard();
  }
}
