import { Module } from "@nestjs/common";
import { MailingEnrollmentModule } from "../enrollment/mailing-enrollment.module";
import { MailingTemplatesModule } from "../templates/mailing-templates.module";
import { MailingAutomationsController } from "./mailing-automations.controller";
import { MailingAutomationsService } from "./mailing-automations.service";

@Module({
  imports: [MailingEnrollmentModule, MailingTemplatesModule],
  controllers: [MailingAutomationsController],
  providers: [MailingAutomationsService],
  exports: [MailingAutomationsService],
})
export class MailingAutomationsModule {}
