import { Module } from "@nestjs/common";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthGuard } from "./admin-auth.guard";
import { AdminAuthService } from "./admin-auth.service";
import { AdminLoginCodesCleanupCron } from "./admin-login-codes-cleanup.cron";
import { AdminSessionsCleanupCron } from "./admin-sessions-cleanup.cron";

@Module({
  controllers: [AdminAuthController],
  providers: [
    AdminAuthService,
    AdminAuthGuard,
    AdminSessionsCleanupCron,
    AdminLoginCodesCleanupCron,
  ],
  exports: [AdminAuthService, AdminAuthGuard],
})
export class AdminAuthModule {}
