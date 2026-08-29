import { Module } from "@nestjs/common";
import { MailingTemplatesController } from "./mailing-templates.controller";
import { MailingTemplatesService } from "./mailing-templates.service";

@Module({
  controllers: [MailingTemplatesController],
  providers: [MailingTemplatesService],
  exports: [MailingTemplatesService],
})
export class MailingTemplatesModule {}
