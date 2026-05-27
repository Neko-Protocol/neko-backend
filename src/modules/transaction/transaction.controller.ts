import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  Post,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { TransactionService } from "./transaction.service";
import { PrepareTransactionDto } from "./dto/prepare-transaction.dto";
import { SubmitTransactionDto } from "./dto/submit-transaction.dto";
import { TransactionHashParamDto } from "./dto/transaction-hash-param.dto";

@Controller("tx")
export class TransactionController {
  constructor(private readonly service: TransactionService) {}

  @Post("prepare")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  prepare(@Body() dto: PrepareTransactionDto, @Ip() ip: string) {
    return this.service.prepare(dto, ip);
  }

  @Post("submit")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  submit(@Body() dto: SubmitTransactionDto, @Ip() ip: string) {
    return this.service.submit(dto, ip);
  }

  @Get(":hash")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  status(@Param() params: TransactionHashParamDto) {
    return this.service.getStatus(params.hash);
  }
}
