import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { StrKey } from "@stellar/stellar-sdk";
import { DashboardService } from "./dashboard.service";
import type {
  DashboardPoolCatalogResponse,
  DashboardPositionsResponse,
  DashboardPricesResponse,
} from "./dashboard.types";

@ApiTags("dashboard")
@Controller({ path: "dashboard", version: VERSION_NEUTRAL })
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get("positions/:wallet")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      "Aggregated pool + vault positions for a wallet. Cached 30s per wallet.",
  })
  getPositions(
    @Param("wallet") wallet: string
  ): Promise<DashboardPositionsResponse> {
    if (!StrKey.isValidEd25519PublicKey(wallet)) {
      throw new BadRequestException({ code: "INVALID_WALLET" });
    }
    return this.svc.getPositions(wallet);
  }

  @Get("pool-catalog")
  @ApiOperation({
    summary: "Pool catalog (Blend/Aqua). Cached 5min, shared.",
  })
  getPoolCatalog(): Promise<DashboardPoolCatalogResponse> {
    return this.svc.getPoolCatalog();
  }

  @Get("prices")
  @ApiOperation({
    summary:
      "USD prices for the requested asset codes (comma-separated). Cached 60s per symbol, shared.",
  })
  getPrices(
    @Query("symbols") symbols?: string
  ): Promise<DashboardPricesResponse> {
    const list = (symbols ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return this.svc.getPrices(list);
  }
}
