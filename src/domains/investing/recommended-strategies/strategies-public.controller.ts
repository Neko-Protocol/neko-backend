import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { RecommendedStrategiesService } from "./recommended-strategies.service";

@ApiTags("strategies")
@Controller("strategies")
export class StrategiesPublicController {
  constructor(private readonly svc: RecommendedStrategiesService) {}

  @Get("recommended")
  @Throttle({
    short: { limit: 10, ttl: 1_000 },
    default: { limit: 30, ttl: 60_000 },
  })
  @ApiOperation({ summary: "Active recommended strategies for the simulator." })
  async recommended() {
    return { strategies: await this.svc.listPublic() };
  }
}
