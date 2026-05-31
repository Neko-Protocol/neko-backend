import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PoolRatesService } from "./pool-rates.service";

@Injectable()
export class PoolRatesCron {
  private readonly logger = new Logger(PoolRatesCron.name);

  constructor(private readonly svc: PoolRatesService) {}

  @Cron("*/30 * * * *", { name: "pool-rates-every-30min" })
  async run(): Promise<void> {
    try {
      const { inserted } = await this.svc.recordOnce();
      this.logger.log(`pool-rates run completed (inserted=${inserted})`);
    } catch (err) {
      this.logger.error(`pool-rates run failed: ${(err as Error).message}`);
    }
  }
}
