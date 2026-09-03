import { Module } from "@nestjs/common";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthGuard } from "./admin-auth.guard";
import { AdminAuthService } from "./admin-auth.service";
import { AdminSessionsCleanupCron } from "./admin-sessions-cleanup.cron";

@Module({
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminAuthGuard, AdminSessionsCleanupCron],
  exports: [AdminAuthService, AdminAuthGuard],
})
export class AdminAuthModule {}
