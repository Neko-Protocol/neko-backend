import { Controller, HttpCode, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { VaultPpsService } from "./vault-pps.service";

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
}
