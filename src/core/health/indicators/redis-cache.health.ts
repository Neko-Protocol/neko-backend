import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HealthIndicator, HealthIndicatorResult } from "@nestjs/terminus";
import { RedisCacheService } from "@core/cache/redis-cache.service";

/**
 * Reports whether the shared cache is actually serving.
 *
 * The cache is fail-open by design: if Redis is unreachable every read goes to
 * its source and nothing errors. That is the right behaviour and a terrible
 * failure mode to leave unobserved — a deployment can run for weeks with the
 * cache silently off, paying for every call, and look perfectly healthy.
 *
 * Never fails readiness. The app genuinely is ready without a cache; this
 * exists to make the difference visible rather than to take a service down.
 */
@Injectable()
export class RedisCacheHealthIndicator extends HealthIndicator {
  constructor(
    private readonly cache: RedisCacheService,
    private readonly config: ConfigService
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const configured = Boolean(this.config.get<string>("REDIS_URL"));
    const connected = this.cache.isEnabled();
    const stats = this.cache.getStats();

    return this.getStatus(key, true, {
      configured,
      connected,
      ...stats,
      // Connected and timing out looks identical to cold from the outside.
      // This is the number that tells them apart.
      failing: stats.timeouts + stats.errors > 0,
      // Spelling out the three states saves reading the boolean pair, and the
      // middle one is the case that hides.
      state: !configured
        ? "disabled"
        : connected
          ? "connected"
          : "configured_but_unreachable",
    });
  }
}
