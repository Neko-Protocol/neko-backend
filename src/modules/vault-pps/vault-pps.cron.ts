import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { VaultPpsService } from "./vault-pps.service";

@Injectable()
export class VaultPpsCron {
  private readonly logger = new Logger(VaultPpsCron.name);

  constructor(private readonly svc: VaultPpsService) {}

  @Cron("0 * * * *", { name: "vault-pps-hourly" })
  async run(): Promise<void> {
    try {
      const { inserted } = await this.svc.recordOnce();
      this.logger.log(`vault-pps run completed (inserted=${inserted})`);
    } catch (err) {
      this.logger.error(`vault-pps run failed: ${(err as Error).message}`);
    }
  }
}
