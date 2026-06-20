import { Module } from "@nestjs/common";
import { AuditModule } from "@domains/platform/audit/audit.module";
import { InvitationsModule } from "../invitations/invitations.module";
import { AdminStrategiesController } from "./admin-strategies.controller";
import { AdminStrategiesService } from "./admin-strategies.service";

@Module({
  imports: [InvitationsModule, AuditModule],
  controllers: [AdminStrategiesController],
  providers: [AdminStrategiesService],
})
export class AdminStrategiesModule {}
