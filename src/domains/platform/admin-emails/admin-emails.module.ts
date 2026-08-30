import { Module } from "@nestjs/common";
import { AdminEmailsController } from "./admin-emails.controller";
import { AdminEmailsService } from "./admin-emails.service";

@Module({
  controllers: [AdminEmailsController],
  providers: [AdminEmailsService],
  exports: [AdminEmailsService],
})
export class AdminEmailsModule {}
