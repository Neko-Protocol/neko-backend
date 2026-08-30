import { Controller, Get, VERSION_NEUTRAL } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";
import { SkipThrottle } from "@nestjs/throttler";
import { SkipAuth } from "../../common/decorators/skip-auth.decorator";
import { SorobanRpcHealthIndicator } from "./indicators/soroban-rpc.health";
import { HorizonHealthIndicator } from "./indicators/horizon.health";
import { RedisCacheHealthIndicator } from "./indicators/redis-cache.health";

@ApiTags("health")
@Controller({ path: "health", version: VERSION_NEUTRAL })
@SkipThrottle()
@SkipAuth()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly soroban: SorobanRpcHealthIndicator,
    private readonly horizon: HorizonHealthIndicator,
    private readonly redis: RedisCacheHealthIndicator
  ) {}

  @Get("liveness")
  @ApiOperation({ summary: "Process-alive probe (no dependency checks)." })
  liveness() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  @Get("readiness")
  @HealthCheck()
  @ApiOperation({
    summary:
      "Readiness probe — pings Soroban RPC and Horizon, returns 503 if either is down.",
  })
  readiness() {
    return this.health.check([
      () => this.soroban.isHealthy("soroban_rpc"),
      () => this.horizon.isHealthy("horizon"),
      () => this.redis.isHealthy("redis_cache"),
    ]);
  }

  // Back-compat alias for probes that hit /health.
  @Get()
  @ApiOperation({ summary: "Alias for /health/liveness." })
  legacy() {
    return this.liveness();
  }
}
