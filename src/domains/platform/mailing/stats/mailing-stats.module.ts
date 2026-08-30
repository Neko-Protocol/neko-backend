import { Module } from "@nestjs/common";
import { MailingStatsService } from "./mailing-stats.service";

@Module({
  providers: [MailingStatsService],
  exports: [MailingStatsService],
})
export class MailingStatsModule {}
