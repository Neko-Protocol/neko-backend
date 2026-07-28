import { Module } from "@nestjs/common";
import { AuditModule } from "@domains/platform/audit/audit.module";
import { SegmentsModule } from "../../segments/segments.module";
import { MailingEnrollmentCron } from "./mailing-enrollment.cron";
import { MailingEnrollmentService } from "./mailing-enrollment.service";

@Module({
  imports: [AuditModule, SegmentsModule],
  providers: [MailingEnrollmentService, MailingEnrollmentCron],
  exports: [MailingEnrollmentService],
})
export class MailingEnrollmentModule {}
