import { Module } from "@nestjs/common";
import { MailingUnsubscribeModule } from "../unsubscribe/mailing-unsubscribe.module";
import { MailingDispatchCron } from "./mailing-dispatch.cron";
import { MailingDispatchService } from "./mailing-dispatch.service";

@Module({
  imports: [MailingUnsubscribeModule],
  providers: [MailingDispatchService, MailingDispatchCron],
  exports: [MailingDispatchService],
})
export class MailingDispatchModule {}
