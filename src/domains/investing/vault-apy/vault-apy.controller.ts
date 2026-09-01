import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { VaultApyService } from "./vault-apy.service";

@ApiTags("vault")
@Controller("vault")
export class VaultApyController {
  constructor(private readonly svc: VaultApyService) {}

  @Get("apy")
  // The throttler keys on the request IP, and browsers reach this through the
  // web-app's backend proxy — so every visitor shares one counter. A dashboard
  // asks for the whole vault catalogue at once, which meant two people loading
  // the page together already exceeded the old 5/s and had requests rejected.
  //
  // Raised now that the answer is served from a five-minute cache: a burst
  // costs one computation per vault, not one per request.
  @Throttle({
    short: { limit: 60, ttl: 1_000 },
    default: { limit: 600, ttl: 60_000 },
  })
  @ApiOperation({
    summary: "Live APY + strategy breakdown for a DeFindex vault.",
  })
  getApy(@Query("vault") vault?: string) {
    return this.svc.getVaultApy(vault ?? null);
  }
}
