import { Controller, Get, Header } from "@nestjs/common";
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { BOND_YIELDS_CACHE_CONTROL } from "./etherfuse.utils";
import { EtherfuseService } from "./etherfuse.service";
import { BondYieldEntryDto } from "./dto/bond-yield-entry.dto";

@ApiTags("etherfuse")
@ApiTooManyRequestsResponse({ description: "Rate-limited." })
@Controller("etherfuse")
export class EtherfuseController {
  constructor(private readonly etherfuse: EtherfuseService) {}

  @Get("bond-yields")
  @Header("Cache-Control", BOND_YIELDS_CACHE_CONTROL)
  @ApiOperation({
    summary: "Bond APY yields for CETES, USTRY, and TESOURO from Etherfuse.",
  })
  @ApiResponse({ status: 200, type: BondYieldEntryDto, isArray: true })
  @ApiResponse({
    status: 502,
    description: "Etherfuse upstream unavailable or payload invalid.",
  })
  @Throttle({
    short: { limit: 10, ttl: 1_000 },
    default: { limit: 30, ttl: 60_000 },
  })
  getBondYields(): Promise<BondYieldEntryDto[]> {
    return this.etherfuse.getBondYields();
  }
}
