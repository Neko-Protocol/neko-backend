import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface RefreshCatalogResult {
  upserted: number;
}

@Injectable()
export class StrategyCatalogService {
  private readonly logger = new Logger(StrategyCatalogService.name);
  private readonly webAppUrl: string | undefined;
  private readonly cronSecret: string | undefined;

  constructor(config: ConfigService) {
    this.webAppUrl = config.get<string>("WEB_APP_URL") || undefined;
    this.cronSecret = config.get<string>("CRON_SECRET") || undefined;
    if (!this.webAppUrl) {
      this.logger.warn(
        "WEB_APP_URL not set — strategy-catalog refresh will be skipped"
      );
    }
  }

  async refresh(): Promise<RefreshCatalogResult> {
    if (!this.webAppUrl) {
      return { upserted: 0 };
    }

    const url = `${this.webAppUrl.replace(/\/$/, "")}/api/strategies/catalog/refresh`;
    const headers: Record<string, string> = {};
    if (this.cronSecret) {
      headers["Authorization"] = `Bearer ${this.cronSecret}`;
    }

    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `strategy-catalog refresh failed (HTTP ${res.status}): ${body.slice(0, 200)}`
      );
    }

    const data = (await res.json()) as { upserted?: number };
    const upserted = typeof data.upserted === "number" ? data.upserted : 0;
    return { upserted };
  }
}
