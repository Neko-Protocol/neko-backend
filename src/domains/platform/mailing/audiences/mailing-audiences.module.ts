import { Module } from "@nestjs/common";
import { AuditModule } from "@domains/platform/audit/audit.module";
import { MailingAudiencesService } from "./mailing-audiences.service";

@Module({
  imports: [AuditModule],
  providers: [MailingAudiencesService],
  exports: [MailingAudiencesService],
})
export class MailingAudiencesModule {}
