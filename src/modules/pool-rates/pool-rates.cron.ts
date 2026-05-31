import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PoolRatesService } from "./pool-rates.service";

@Injectable()
export class PoolRatesCron {
  private readonly logger = new Logger(PoolRatesCron.name);

  constructor(private readonly svc: PoolRatesService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: "pool-rates-hourly" })
  async hourly(): Promise<void> {
    try {
      const { inserted } = await this.svc.recordOnce();
      this.logger.log(`hourly run completed (inserted=${inserted})`);
    } catch (err) {
      this.logger.error(`hourly run failed: ${(err as Error).message}`);
    }
  }
}
