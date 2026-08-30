import { Module } from "@nestjs/common";
import { MailingAudiencesModule } from "./audiences/mailing-audiences.module";
import { MailingDispatchModule } from "./dispatch/mailing-dispatch.module";
import { MailingEnrollmentModule } from "./enrollment/mailing-enrollment.module";
import { MailingMessagesModule } from "./messages/mailing-messages.module";
import { MailingOpsController } from "./mailing-ops.controller";
import { MailingStatsModule } from "./stats/mailing-stats.module";
import { MailingTemplatesModule } from "./templates/mailing-templates.module";
import { MailingUnsubscribeModule } from "./unsubscribe/mailing-unsubscribe.module";

@Module({
  imports: [
    MailingAudiencesModule,
    MailingDispatchModule,
    MailingEnrollmentModule,
    MailingMessagesModule,
    MailingStatsModule,
    MailingTemplatesModule,
    MailingUnsubscribeModule,
  ],
  controllers: [MailingOpsController],
})
export class MailingModule {}
