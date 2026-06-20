import { Controller, HttpCode, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { StrategyCatalogService } from "./strategy-catalog.service";

@ApiTags("strategy-catalog")
@Controller("strategy-catalog")
export class StrategyCatalogController {
  constructor(private readonly svc: StrategyCatalogService) {}

  @Post("run-now")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      "Manually trigger the strategy-catalog refresh job (internal only).",
  })
  runNow() {
    return this.svc.refresh();
  }
}
