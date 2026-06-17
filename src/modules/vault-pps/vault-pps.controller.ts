import { Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { VaultPpsService } from "./vault-pps.service";
import { VaultIdParamDto } from "./dto/vault-id-param.dto";

@ApiTags("vault-pps")
@Controller("vault-pps")
export class VaultPpsController {
  constructor(private readonly svc: VaultPpsService) {}

  @Post("run-now")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: "Manually trigger the vault-pps recording job (internal only).",
  })
  runNow() {
    return this.svc.recordOnce();
  }

  @Get(":vaultId")
  @Throttle({
    short: { limit: 10, ttl: 1_000 },
    default: { limit: 30, ttl: 60_000 },
  })
  @ApiOperation({
    summary: "Price-per-share history for a vault (last 30 days) + 7-day APY.",
  })
  getHistory(@Param() params: VaultIdParamDto) {
    return this.svc.getHistory(params.vaultId);
  }
}
