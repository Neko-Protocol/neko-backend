import { Controller, HttpCode, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { VaultInvestService } from "./vault-invest.service";

@ApiTags("vault-invest")
@Controller("vault-invest")
export class VaultInvestController {
  constructor(private readonly svc: VaultInvestService) {}

  @Post("run-now")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      "Manually trigger the vault-invest keeper job (internal only). Pass ?vault=<id> for a single vault.",
  })
  @ApiQuery({ name: "vault", required: false, type: String })
  runNow(@Query("vault") vault?: string) {
    const trimmed = typeof vault === "string" ? vault.trim() : "";
    if (trimmed) return this.svc.runSingle(trimmed, "manual");
    return this.svc.runBatch("manual");
  }
}
