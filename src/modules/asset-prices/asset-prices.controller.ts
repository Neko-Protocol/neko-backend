import { Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AssetPricesService } from "./asset-prices.service";
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

  @Get(":symbol")
  @Throttle({
    short: { limit: 10, ttl: 1_000 },
    default: { limit: 30, ttl: 60_000 },
  })
  @ApiOperation({ summary: "Price history for an asset symbol (last 7 days)." })
  async getHistory(@Param() params: SymbolParamDto) {
    return { data: await this.svc.getHistory(params.symbol) };
  }
}
