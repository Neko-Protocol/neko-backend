import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { MailingEnrollmentService } from "./mailing-enrollment.service";

@Injectable()
export class MailingEnrollmentCron {
  private readonly logger = new Logger(MailingEnrollmentCron.name);

  constructor(private readonly svc: MailingEnrollmentService) {}

  @Cron("*/15 * * * *", { name: "mailing-enrollment-every-15min" })
  async run(): Promise<void> {
    try {
      const result = await this.svc.run();
      this.logger.log(
        `mailing-enrollment run completed (${result.automationsProcessed} automations, ${result.enrolled} enrolled)`
      );
    } catch (err) {
      this.logger.error(
        `mailing-enrollment run failed: ${(err as Error).message}`,
        (err as Error).stack
      );
    }
  }
}
