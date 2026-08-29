import { Module } from "@nestjs/common";
import { MailingAudiencesModule } from "./audiences/mailing-audiences.module";
import { MailingAutomationsModule } from "./automations/mailing-automations.module";
import { MailingBroadcastsModule } from "./broadcasts/mailing-broadcasts.module";
import { MailingDispatchModule } from "./dispatch/mailing-dispatch.module";
import { MailingEnrollmentModule } from "./enrollment/mailing-enrollment.module";
import { MailingOpsController } from "./mailing-ops.controller";
import { MailingTemplatesModule } from "./templates/mailing-templates.module";
import { MailingUnsubscribeModule } from "./unsubscribe/mailing-unsubscribe.module";

@Module({
  imports: [
    MailingAudiencesModule,
    MailingAutomationsModule,
    MailingBroadcastsModule,
    MailingDispatchModule,
    MailingEnrollmentModule,
    MailingTemplatesModule,
    MailingUnsubscribeModule,
  ],
  controllers: [MailingOpsController],
})
export class MailingModule {}
