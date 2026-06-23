import { Module } from "@nestjs/common";
import { AuditModule } from "@domains/platform/audit/audit.module";
import { AdminDashboardController } from "./admin-dashboard.controller";
import { AdminDashboardService } from "./admin-dashboard.service";

@Module({
  imports: [AuditModule],
  controllers: [AdminDashboardController],
  providers: [AdminDashboardService],
})
export class AdminDashboardModule {}
