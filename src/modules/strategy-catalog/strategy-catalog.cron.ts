import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { StrategyCatalogService } from "./strategy-catalog.service";

@Injectable()
export class StrategyCatalogCron {
  private readonly logger = new Logger(StrategyCatalogCron.name);
  constructor(private readonly svc: StrategyCatalogService) {}

  @Cron("30 * * * *", { name: "strategy-catalog-hourly" })
  async run(): Promise<void> {
    try {
      const { upserted } = await this.svc.refresh();
      this.logger.log(`strategy-catalog run completed (upserted=${upserted})`);
    } catch (err) {
      this.logger.error(
        `strategy-catalog run failed: ${(err as Error).message}`
      );
    }
  }
}
