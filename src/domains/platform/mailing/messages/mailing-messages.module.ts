import { Module } from "@nestjs/common";
import { MailingAudiencesModule } from "../audiences/mailing-audiences.module";
import { MailingDispatchModule } from "../dispatch/mailing-dispatch.module";
import { MailingTemplatesModule } from "../templates/mailing-templates.module";
import { MailingBroadcastSendService } from "./mailing-broadcast-send.service";
import { MailingMessagesController } from "./mailing-messages.controller";
import { MailingMessagesService } from "./mailing-messages.service";

@Module({
  imports: [
    MailingAudiencesModule,
    MailingDispatchModule,
    MailingTemplatesModule,
  ],
  controllers: [MailingMessagesController],
  providers: [MailingMessagesService, MailingBroadcastSendService],
  exports: [MailingMessagesService],
})
export class MailingMessagesModule {}
