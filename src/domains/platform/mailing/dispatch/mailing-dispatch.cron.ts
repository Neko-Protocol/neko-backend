import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { MailingDispatchService } from "./mailing-dispatch.service";

@Injectable()
export class MailingDispatchCron {
  private readonly logger = new Logger(MailingDispatchCron.name);

  constructor(private readonly svc: MailingDispatchService) {}

  @Cron("*/5 * * * *", { name: "mailing-dispatch-every-5min" })
  async run(): Promise<void> {
    try {
      const result = await this.svc.run();
      this.logger.log(
        `mailing-dispatch run completed (sent=${result.sent}, skipped=${result.skipped}, failed=${result.failed})`
      );
    } catch (err) {
      this.logger.error(
        `mailing-dispatch run failed: ${(err as Error).message}`,
        (err as Error).stack
      );
    }
  }
}
