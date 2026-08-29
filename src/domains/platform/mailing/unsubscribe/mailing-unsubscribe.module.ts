import { Module } from "@nestjs/common";
import { MailingUnsubscribeController } from "./mailing-unsubscribe.controller";
import { MailingUnsubscribeService } from "./mailing-unsubscribe.service";
import { MailingUnsubscribeTokenService } from "./mailing-unsubscribe-token.service";

@Module({
  controllers: [MailingUnsubscribeController],
  providers: [MailingUnsubscribeTokenService, MailingUnsubscribeService],
  exports: [MailingUnsubscribeTokenService],
})
export class MailingUnsubscribeModule {}
