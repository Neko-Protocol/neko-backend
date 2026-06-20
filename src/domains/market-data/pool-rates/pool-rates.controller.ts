import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from "@nestjs/common";
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { PoolRatesService } from "./pool-rates.service";
import { PoolIdParamDto } from "./dto/pool-id-param.dto";
import { PoolRateHistoryEntryDto } from "./dto/pool-rate-history-entry.dto";
import { RecordRatesResponseDto } from "./dto/record-rates-response.dto";

@ApiTags("pool-rates")
@ApiTooManyRequestsResponse({ description: "Rate-limited." })
@Controller("pool-rates")
export class PoolRatesController {
  constructor(private readonly poolRates: PoolRatesService) {}

  @Get(":poolId")
  @Throttle({
    short: { limit: 10, ttl: 1_000 },
    default: { limit: 30, ttl: 60_000 },
  })
  @ApiOperation({ summary: "APY rate history for a pool (last 7 days)." })
  @ApiResponse({ status: 200, type: PoolRateHistoryEntryDto, isArray: true })
  getHistory(
    @Param() params: PoolIdParamDto
  ): Promise<PoolRateHistoryEntryDto[]> {
    return this.poolRates.getHistory(params.poolId);
  }

  @Post("record")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Fetch live APYs from all adapters and persist to Supabase.",
  })
  @ApiResponse({ status: 200, type: RecordRatesResponseDto })
  recordRates(): Promise<RecordRatesResponseDto> {
    return this.poolRates.recordRates();
  }
}
