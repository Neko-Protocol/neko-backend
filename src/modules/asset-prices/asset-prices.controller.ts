import { Controller, HttpCode, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AssetPricesService } from "./asset-prices.service";

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
}
