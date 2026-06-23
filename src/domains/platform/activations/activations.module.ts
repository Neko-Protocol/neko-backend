import { Module } from "@nestjs/common";
import { AuditModule } from "@domains/platform/audit/audit.module";
import { ActivationsController } from "./activations.controller";
import { ActivationsService } from "./activations.service";

@Module({
  imports: [AuditModule],
  controllers: [ActivationsController],
  providers: [ActivationsService],
})
export class ActivationsModule {}
