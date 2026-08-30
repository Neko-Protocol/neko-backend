import { Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AssetPricesService } from "./asset-prices.service";
import { SpotSymbolsDto } from "./dto/spot-symbols.dto";
import { SymbolParamDto } from "./dto/symbol-param.dto";

@ApiTags("asset-prices")
@Controller("asset-prices")
export class AssetPricesController {
  constructor(private readonly svc: AssetPricesService) {}

  @Post("run-now")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: "Manually trigger the asset-prices recording job (internal only).",
  })
  runNow() {
    return this.svc.recordOnce();
  }

  /**
   * Declared before `:symbol` on purpose — Nest matches routes in order, and
   * the parameterised route would otherwise swallow "spot" as an asset code.
   */
  @Get("spot")
  @Throttle({
    short: { limit: 20, ttl: 1_000 },
    default: { limit: 120, ttl: 60_000 },
  })
  @ApiQuery({
    name: "symbols",
    example: "XLM,USDC,GYEN",
    description: "Comma-separated asset codes.",
  })
  @ApiOperation({
    summary: "Current USD price for one or more asset symbols.",
  })
  async getSpot(@Query() query: SpotSymbolsDto) {
    return { data: await this.svc.getSpotPrices(query.symbols) };
  }

  @Get(":symbol")
  @Throttle({
    short: { limit: 10, ttl: 1_000 },
    default: { limit: 30, ttl: 60_000 },
  })
  @ApiOperation({
    summary: "Hourly price history for an asset symbol (last 30 days).",
  })
  async getHistory(@Param() params: SymbolParamDto) {
    return { data: await this.svc.getHistory(params.symbol) };
  }
}
