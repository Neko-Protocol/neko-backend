import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import {
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { SkipAuth } from "../../../common/decorators/skip-auth.decorator";
import { FaucetUsdcDto } from "../dto/faucet-usdc.dto";
import { FaucetService } from "./faucet.service";
import { OpportunitiesService } from "./opportunities.service";

@ApiTags("launchpad")
@ApiTooManyRequestsResponse({ description: "Rate-limited." })
@Controller("launchpad/faucet")
export class FaucetController {
  constructor(private readonly faucet: FaucetService) {}

  // Behind the global internal-key guard: reachable from the Launchpad and
  // Neko Pro proxies only.
  @Post("usdc")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Testnet only: send test USDC to an address." })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  payUsdc(@Body() dto: FaucetUsdcDto): Promise<{ tx_hash: string }> {
    return this.faucet.payUsdc(dto.address, dto.amount);
  }
}

@ApiTags("launchpad")
@ApiTooManyRequestsResponse({ description: "Rate-limited." })
@Controller("launchpad/opportunities")
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  // Public: each vault's metadata_uri points here.
  @Get()
  @SkipAuth()
  @ApiOperation({ summary: "Live Launchpad vaults for Neko Pro." })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  list() {
    return this.opportunities.list();
  }

  @Get(":id")
  @SkipAuth()
  @ApiOperation({ summary: "One live vault; also its on-chain metadata_uri." })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.opportunities.get(id);
  }
}
