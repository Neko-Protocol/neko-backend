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
      const failed = result.vaults.filter((v) => !v.success);

      if (failed.length === 0) {
        this.logger.log(
          `vault-invest run completed (${result.vaults.length} vaults processed)`
        );
        return;
      }

      this.logger.error(
        `vault-invest run completed with ${failed.length}/${result.vaults.length} vaults failing: ${failed
          .map(
            (v) =>
              `${v.label} [${v.rebalance.status}]${
                v.warnings.length ? ` ${v.warnings.join("; ")}` : ""
              }`
          )
          .join(" | ")}`
      );
    } catch (err) {
      this.logger.error(
        `vault-invest run failed: ${(err as Error).message}`,
        (err as Error).stack
      );
    }
  }
}
