import { Module } from "@nestjs/common";
import { MailingAudiencesModule } from "../audiences/mailing-audiences.module";
import { MailingTemplatesController } from "./mailing-templates.controller";
import { MailingTemplatesService } from "./mailing-templates.service";

@Module({
  imports: [MailingAudiencesModule],
  controllers: [MailingTemplatesController],
  providers: [MailingTemplatesService],
  exports: [MailingTemplatesService],
})
export class MailingTemplatesModule {}
