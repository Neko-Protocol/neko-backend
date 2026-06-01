import { Controller, HttpCode, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { PoolRatesService } from "./pool-rates.service";

@ApiTags("pool-rates")
@Controller("pool-rates")
export class PoolRatesController {
  constructor(private readonly svc: PoolRatesService) {}

  @Post("run-now")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: "Manually trigger the pool-rates recording job (internal only).",
  })
  runNow() {
    return this.svc.recordOnce();
  }
}
