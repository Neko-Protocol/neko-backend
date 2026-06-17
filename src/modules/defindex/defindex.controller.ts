import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { DefindexService } from "./defindex.service";

@ApiTags("defindex")
@Controller("defindex")
export class DefindexController {
  constructor(private readonly svc: DefindexService) {}

  @Get("vaults")
  @Throttle({
    short: { limit: 5, ttl: 1_000 },
    default: { limit: 20, ttl: 60_000 },
  })
  @ApiOperation({
    summary: "Raw DeFindex vault info + USD prices for configured vaults.",
  })
  getVaults() {
    return this.svc.getVaults();
  }
}
