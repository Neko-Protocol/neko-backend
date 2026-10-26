import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AccountsService } from "./accounts.service";
import { CreateAccountDto } from "./dto/create-account.dto";
import { CreateVerificationDto } from "./dto/create-verification.dto";
import { MockVerificationDto } from "./dto/mock-verification.dto";
import {
  CLAIM_TOKEN_HEADER,
  LaunchpadErrorCode,
  type LaunchpadAccountView,
  type StartedVerification,
  type VerificationView,
} from "./launchpad.types";
import { VerificationsService } from "./verifications.service";

@ApiTags("launchpad")
@ApiTooManyRequestsResponse({ description: "Rate-limited." })
@Controller("launchpad")
export class LaunchpadController {
  constructor(
    private readonly verifications: VerificationsService,
    private readonly accounts: AccountsService
  ) {}

  @Post("verifications")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Start a Didit KYC/KYB session." })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  start(@Body() dto: CreateVerificationDto): Promise<StartedVerification> {
    return this.verifications.start(dto.kind, dto.app);
  }

  @Post("verifications/mock")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      "Demo only: approved verification without Didit (KYC_MOCK_ENABLED).",
  })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  startMock(@Body() dto: MockVerificationDto): Promise<StartedVerification> {
    return this.verifications.startMock(dto.kind, dto.name);
  }

  @Get("verifications/:id")
  @ApiOperation({ summary: "Verification status (pulls the Didit decision)." })
  @ApiHeader({ name: CLAIM_TOKEN_HEADER, required: true })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  get(
    @Param("id", ParseUUIDPipe) id: string,
    @Headers(CLAIM_TOKEN_HEADER) claimToken?: string
  ): Promise<VerificationView> {
    return this.verifications.get(id, claimToken);
  }

  @Post("accounts")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Create the account and testnet wallet for an approved verification.",
  })
  @ApiHeader({ name: CLAIM_TOKEN_HEADER, required: true })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createAccount(
    @Body() dto: CreateAccountDto,
    @Headers(CLAIM_TOKEN_HEADER) claimToken?: string
  ): Promise<LaunchpadAccountView> {
    return this.accounts.create(dto.verification_id, claimToken, dto.email);
  }

  @Get("me")
  @ApiOperation({
    summary: "Account and wallet for the Privy user logged in by email.",
  })
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  me(
    @Headers("authorization") authorization?: string
  ): Promise<LaunchpadAccountView> {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      throw new UnauthorizedException({
        code: LaunchpadErrorCode.MISSING_ACCESS_TOKEN,
      });
    }
    return this.accounts.getByAccessToken(token);
  }
}
