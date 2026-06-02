import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { VaultInvestService } from "./vault-invest.service";

@Injectable()
export class VaultInvestCron {
  private readonly logger = new Logger(VaultInvestCron.name);

  constructor(private readonly svc: VaultInvestService) {}

  @Cron("*/30 * * * *", { name: "vault-invest-every-30min" })
  async run(): Promise<void> {
    try {
      const result = await this.svc.runBatch("cron");
      this.logger.log(
        `vault-invest run completed (${result.vaults.length} vaults processed)`
      );
    } catch (err) {
      this.logger.error(
        `vault-invest run failed: ${(err as Error).message}`,
        (err as Error).stack
      );
    }
  }
}
