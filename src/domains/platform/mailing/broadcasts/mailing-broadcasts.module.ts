import { Module } from "@nestjs/common";
import { MailingAudiencesModule } from "../audiences/mailing-audiences.module";
import { MailingUnsubscribeModule } from "../unsubscribe/mailing-unsubscribe.module";
import { MailingBroadcastsController } from "./mailing-broadcasts.controller";
import { MailingBroadcastsService } from "./mailing-broadcasts.service";

@Module({
  imports: [MailingAudiencesModule, MailingUnsubscribeModule],
  controllers: [MailingBroadcastsController],
  providers: [MailingBroadcastsService],
  exports: [MailingBroadcastsService],
})
export class MailingBroadcastsModule {}
