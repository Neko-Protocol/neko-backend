import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AuditService } from "./audit.service";
import { CreateAuditDto } from "./dto/create-audit.dto";
import { ListAuditQueryDto } from "./dto/list-audit-query.dto";

@ApiTags("audit")
@Controller("audit")
export class AuditController {
  constructor(private readonly svc: AuditService) {}

  @Post()
  @Throttle({
    short: { limit: 10, ttl: 1_000 },
    default: { limit: 60, ttl: 60_000 },
  })
  @ApiOperation({ summary: "Log a user action (swap, deposit, …)." })
  log(@Body() dto: CreateAuditDto) {
    return this.svc.log(dto);
  }

  @Get()
  @Throttle({
    short: { limit: 10, ttl: 1_000 },
    default: { limit: 30, ttl: 60_000 },
  })
  @ApiOperation({ summary: "List audit logs (optionally filtered by wallet)." })
  list(@Query() query: ListAuditQueryDto) {
    const limit = Number(query.limit ?? "50");
    return this.svc.list(query.wallet, Number.isFinite(limit) ? limit : 50);
  }
}
