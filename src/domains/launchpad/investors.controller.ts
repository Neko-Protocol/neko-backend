import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from "@nestjs/common";
import {
  ApiHeader,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CreateInvestorDto } from "./dto/create-investor.dto";
import { InvestorsService } from "./investors.service";
import { CLAIM_TOKEN_HEADER, type InvestorView } from "./launchpad.types";

@ApiTags("launchpad")
@ApiTooManyRequestsResponse({ description: "Rate-limited." })
@Controller("launchpad/investors")
export class InvestorsController {
  constructor(private readonly investors: InvestorsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Whitelist a wallet for Neko Pro with an approved verification.",
  })
  @ApiHeader({ name: CLAIM_TOKEN_HEADER, required: true })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(
    @Body() dto: CreateInvestorDto,
    @Headers(CLAIM_TOKEN_HEADER) claimToken?: string
  ): Promise<InvestorView> {
    return this.investors.create(
      dto.verification_id,
      claimToken,
      dto.wallet_address
    );
  }

  @Post(":wallet/onchain")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Register a whitelisted wallet on-chain (identity, KYC/AML claims). Idempotent.",
  })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  registerOnchain(@Param("wallet") wallet: string): Promise<InvestorView> {
    return this.investors.registerOnchain(wallet);
  }

  @Get(":wallet")
  @ApiOperation({ summary: "Neko Pro whitelist status for a wallet." })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  get(@Param("wallet") wallet: string): Promise<InvestorView> {
    return this.investors.get(wallet);
  }
}
