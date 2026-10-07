import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { ErrorCode } from "@neko-protocol/api-contracts";
import { SkipAuth } from "@common/decorators/skip-auth.decorator";
import { PrivyPrincipal } from "@common/decorators/privy-principal.decorator";
import { PrivyAuthGuard } from "@common/guards/privy-auth.guard";
import type { PrivyPrincipal as Principal } from "@core/privy/privy.types";
import { PrepareTransactionDto } from "@domains/chain/transaction/dto/prepare-transaction.dto";
import { SubmitTransactionDto } from "@domains/chain/transaction/dto/submit-transaction.dto";
import { TransactionService } from "@domains/chain/transaction/transaction.service";
import { AccountsService } from "./accounts.service";
import { WalletActivationService } from "./wallet-activation.service";
import { ActivationSubmitDto } from "./dto/activation-submit.dto";
import { TrustlinesPrepareDto } from "./dto/trustlines-prepare.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";

/**
 * End-user routes authenticated with a Privy access token. They skip the
 * internal-key guard because the mobile app calls them directly.
 */
@ApiTags("me")
@ApiBearerAuth()
@ApiTooManyRequestsResponse({ description: "Rate-limited." })
@ApiResponse({ status: 401, description: "UNAUTHORIZED / PRIVY_TOKEN_INVALID" })
@SkipAuth()
@UseGuards(PrivyAuthGuard)
@Controller("me")
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly activation: WalletActivationService,
    private readonly transactions: TransactionService
  ) {}

  @Post("bootstrap")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Create or refresh the caller's account, identity and wallets.",
  })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  bootstrap(@PrivyPrincipal() principal: Principal) {
    return this.accounts.bootstrap(principal);
  }

  @Get()
  @ApiOperation({ summary: "The caller's account and wallets." })
  @ApiResponse({ status: 404, description: "ACCOUNT_NOT_FOUND" })
  me(@PrivyPrincipal() principal: Principal) {
    return this.accounts.me(principal);
  }

  @Patch("profile")
  @ApiOperation({ summary: "Save the 'about you' step and terms acceptance." })
  updateProfile(
    @PrivyPrincipal() principal: Principal,
    @Body() dto: UpdateProfileDto
  ) {
    return this.accounts.updateProfile(principal, dto);
  }

  @Post("wallet/activation/prepare")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Sponsor-signed activation XDR for the caller to co-sign.",
  })
  @ApiResponse({ status: 409, description: "ALREADY_ACTIVATED" })
  @ApiResponse({ status: 503, description: "SPONSOR_UNAVAILABLE" })
  @Throttle({ default: { limit: 2, ttl: 300_000 } })
  prepareActivation(@PrivyPrincipal() principal: Principal) {
    return this.activation.prepare(principal);
  }

  @Post("wallet/activation/submit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Submit the co-signed activation." })
  @ApiResponse({ status: 403, description: "ACTIVATION_TX_MISMATCH" })
  @Throttle({ default: { limit: 2, ttl: 300_000 } })
  submitActivation(
    @PrivyPrincipal() principal: Principal,
    @Body() dto: ActivationSubmitDto,
    @Req() req: Request
  ) {
    return this.activation.submit(principal, dto.signedXdr, req.traceId);
  }

  @Post("wallet/trustlines/prepare")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Sponsor-signed XDR opening trustlines the caller's activated wallet needs.",
  })
  @ApiResponse({
    status: 409,
    description: "WALLET_NOT_ACTIVATED / TRUSTLINE_EXISTS",
  })
  @ApiResponse({
    status: 422,
    description: "DISALLOWED_OPERATION (asset not sponsorable)",
  })
  @ApiResponse({
    status: 503,
    description: "SPONSOR_UNAVAILABLE / SPONSOR_BUSY",
  })
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  prepareTrustlines(
    @PrivyPrincipal() principal: Principal,
    @Body() dto: TrustlinesPrepareDto
  ) {
    return this.activation.prepareTrustlines(principal, dto.assets);
  }

  @Post("wallet/trustlines/submit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Submit the co-signed trustlines transaction." })
  @ApiResponse({ status: 403, description: "ACTIVATION_TX_MISMATCH" })
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  submitTrustlines(
    @PrivyPrincipal() principal: Principal,
    @Body() dto: ActivationSubmitDto,
    @Req() req: Request
  ) {
    return this.activation.submitTrustlines(
      principal,
      dto.signedXdr,
      req.traceId
    );
  }

  @Post("tx/prepare")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Same as /tx/prepare, but the source must be the caller's activated wallet.",
  })
  @Throttle({
    short: { limit: 10, ttl: 1_000 },
    default: { limit: 30, ttl: 60_000 },
  })
  async prepareTx(
    @PrivyPrincipal() principal: Principal,
    @Body() dto: PrepareTransactionDto,
    @Ip() ip: string,
    @Req() req: Request
  ) {
    const address = await this.activatedAddress(principal);
    return this.transactions.prepare(dto, ip, req.traceId, {
      sponsorFor: address,
    });
  }

  @Post("tx/submit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Same as /tx/submit, with the network fee paid by the sponsor.",
  })
  @ApiResponse({ status: 422, description: "SPONSOR_FEE_TOO_HIGH" })
  @Throttle({
    short: { limit: 5, ttl: 1_000 },
    default: { limit: 15, ttl: 60_000 },
  })
  async submitTx(
    @PrivyPrincipal() principal: Principal,
    @Body() dto: SubmitTransactionDto,
    @Ip() ip: string,
    @Req() req: Request
  ) {
    const address = await this.activatedAddress(principal);
    return this.transactions.submit(dto, ip, req.traceId, {
      sponsorFor: address,
    });
  }

  private async activatedAddress(principal: Principal): Promise<string> {
    const wallet = await this.accounts.requirePrimaryWallet(principal);
    if (wallet.activation_status !== "activated") {
      throw new ConflictException({ code: ErrorCode.WALLET_NOT_ACTIVATED });
    }
    return wallet.address;
  }
}
