import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  Post,
  HttpCode,
  HttpStatus,
  Req,
} from "@nestjs/common";
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { TransactionService } from "./transaction.service";
import { PrepareTransactionDto } from "./dto/prepare-transaction.dto";
import { SubmitTransactionDto } from "./dto/submit-transaction.dto";
import { TransactionHashParamDto } from "./dto/transaction-hash-param.dto";
import { TransactionPreparedDto } from "./dto/transaction-prepared.dto";
import { TransactionStatusDto } from "./dto/transaction-status.dto";

@ApiTags("transactions")
@ApiTooManyRequestsResponse({ description: "Rate-limited." })
@Controller("tx")
export class TransactionController {
  constructor(private readonly service: TransactionService) {}

  @Post("prepare")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Validate an unsigned XDR and cache its hash for a later submit.",
  })
  @ApiResponse({ status: 200, type: TransactionPreparedDto })
  @ApiResponse({ status: 400, description: "INVALID_XDR" })
  @ApiResponse({
    status: 422,
    description: "Disallowed contract or operation, or fee-bump envelope.",
  })
  @Throttle({
    short: { limit: 10, ttl: 1_000 },
    default: { limit: 30, ttl: 60_000 },
  })
  prepare(
    @Body() dto: PrepareTransactionDto,
    @Ip() ip: string,
    @Req() req: Request
  ) {
    return this.service.prepare(dto, ip, req.traceId);
  }

  @Post("submit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Submit a signed XDR that was previously prepared.",
  })
  @ApiResponse({ status: 200, type: TransactionStatusDto })
  @ApiResponse({ status: 400, description: "INVALID_XDR" })
  @ApiResponse({
    status: 403,
    description:
      "SUBMIT_REJECTED — cache miss, hash mismatch, passphrase mismatch, source mismatch, or fee-bump envelope.",
  })
  @ApiResponse({
    status: 422,
    description: "Soroban contract error (mapped) or send-error.",
  })
  @Throttle({
    short: { limit: 5, ttl: 1_000 },
    default: { limit: 15, ttl: 60_000 },
  })
  submit(
    @Body() dto: SubmitTransactionDto,
    @Ip() ip: string,
    @Req() req: Request
  ) {
    return this.service.submit(dto, ip, req.traceId);
  }

  @Get(":hash")
  @ApiOperation({
    summary: "Look up the status of a submitted transaction by hash.",
  })
  @ApiResponse({ status: 200, type: TransactionStatusDto })
  @Throttle({
    short: { limit: 20, ttl: 1_000 },
    default: { limit: 60, ttl: 60_000 },
  })
  status(@Param() params: TransactionHashParamDto) {
    return this.service.getStatus(params.hash);
  }
}
