import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { NotificationsEnrollmentService } from "./notifications-enrollment.service";

@Injectable()
export class NotificationsEnrollmentCron {
  private readonly logger = new Logger(NotificationsEnrollmentCron.name);

  constructor(private readonly svc: NotificationsEnrollmentService) {}

  // Hourly rather than every 15 minutes: both triggers are day-scale states,
  // so a tighter schedule would only re-scan the same rows.
  @Cron("0 * * * *", { name: "notifications-enrollment-hourly" })
  async run(): Promise<void> {
    try {
      const result = await this.svc.run();
      if (result.emitted > 0) {
        this.logger.log(
          `notifications-enrollment run completed (emitted=${result.emitted})`
        );
      }
    } catch (err) {
      this.logger.error(
        `notifications-enrollment run failed: ${(err as Error).message}`,
        (err as Error).stack
      );
    }
  }
}
