import {
  Controller,
  Get,
  Header,
  Req,
  UnauthorizedException,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiExcludeController } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { timingSafeEqual } from "crypto";
import type { Request } from "express";
import { ErrorCode } from "@neko/api-contracts";
import { SkipAuth } from "../../../common/decorators/skip-auth.decorator";
import { MetricsRegistryService } from "./metrics-registry.service";

/**
 * Prometheus scrape endpoint.
 *
 * Outside the internal-key guard, because Grafana Cloud scrapes it directly
 * rather than through the web-app proxy — but not public: the exposition
 * leaks traffic shape, method mix and upstream endpoint names, so it carries
 * its own bearer token.
 *
 * With METRICS_SCRAPE_TOKEN unset the endpoint refuses everything rather than
 * defaulting open, so forgetting to configure it cannot silently publish it.
 */
@ApiExcludeController()
@Controller({ path: "metrics", version: VERSION_NEUTRAL })
@SkipThrottle()
@SkipAuth()
export class MetricsController {
  constructor(
    private readonly registry: MetricsRegistryService,
    private readonly config: ConfigService
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async scrape(@Req() req: Request): Promise<string> {
    this.assertAuthorized(req);
    return this.registry.metrics();
  }

  private assertAuthorized(req: Request): void {
    const expected = this.config.get<string>("METRICS_SCRAPE_TOKEN");
    if (!expected) {
      throw new UnauthorizedException({
        code: ErrorCode.NOT_CONFIGURED,
        message: "METRICS_SCRAPE_TOKEN is not set — /metrics is disabled.",
      });
    }

    const header = req.headers.authorization ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";

    if (!presented || !safeEqual(presented, expected)) {
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED });
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
