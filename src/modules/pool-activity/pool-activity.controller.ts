import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { PoolIdParamDto } from "../pool-rates/dto/pool-id-param.dto";
import { PoolActivityService } from "./pool-activity.service";

@ApiTags("pool-activity")
@Controller("pool-activity")
export class PoolActivityController {
  constructor(private readonly svc: PoolActivityService) {}

  @Get(":poolId")
  @Throttle({
    short: { limit: 10, ttl: 1_000 },
    default: { limit: 30, ttl: 60_000 },
  })
  @ApiOperation({ summary: "Recent on-chain events for a pool contract." })
  async getActivity(@Param() params: PoolIdParamDto) {
    return { events: await this.svc.getActivity(params.poolId) };
  }
}
