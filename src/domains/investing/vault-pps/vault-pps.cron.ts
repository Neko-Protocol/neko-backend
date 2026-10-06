import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { NotificationsService } from "@domains/platform/notifications/notifications.service";
import { VaultPpsService } from "./vault-pps.service";

@Injectable()
export class VaultPpsCron {
  private readonly logger = new Logger(VaultPpsCron.name);
  /** UTC day the valuation was last sent, to skip the lookup on later runs. */
  private lastValuationDay: string | null = null;

  constructor(
    private readonly svc: VaultPpsService,
    private readonly notifications: NotificationsService
  ) {}

  @Cron("0 * * * *", { name: "vault-pps-hourly" })
  async run(): Promise<void> {
    try {
      const { inserted } = await this.svc.recordOnce();
      this.logger.log(`vault-pps run completed (inserted=${inserted})`);
      if (inserted > 0) await this.notifyDailyValuation();
    } catch (err) {
      this.logger.error(`vault-pps run failed: ${(err as Error).message}`);
    }
  }

  /**
   * In-app + push "portfolio valuation" for every wallet with vault deposits,
   * once per UTC day: the first run of the day that records fresh vault prices
   * sends it, and the dedupe key keeps later runs (or a restart) from repeating.
   */
  private async notifyDailyValuation(): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    if (this.lastValuationDay === day) return;

    try {
      const wallets = await this.notifications.vaultDepositors();
      for (const wallet of wallets) {
        await this.notifications.emit({
          trigger: "portfolio_valuation",
          walletAddress: wallet,
          dedupeKey: `portfolio_valuation:${day}`,
        });
      }
      this.lastValuationDay = day;
    } catch (err) {
      this.logger.warn(
        `portfolio valuation notification failed: ${(err as Error).message}`
      );
    }
  }
}
