import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { VaultApyService } from "./vault-apy.service";

@ApiTags("vault")
@Controller("vault")
export class VaultApyController {
  constructor(private readonly svc: VaultApyService) {}

  @Get("apy")
  @Throttle({
    short: { limit: 5, ttl: 1_000 },
    default: { limit: 20, ttl: 60_000 },
  })
  @ApiOperation({
    summary: "Live APY + strategy breakdown for a DeFindex vault.",
  })
  getApy(@Query("vault") vault?: string) {
    return this.svc.getVaultApy(vault ?? null);
  }
}
