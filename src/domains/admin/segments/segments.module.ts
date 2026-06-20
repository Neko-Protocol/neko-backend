import { Module } from "@nestjs/common";
import { AuditModule } from "@domains/platform/audit/audit.module";
import { SegmentsController } from "./segments.controller";
import { SegmentsService } from "./segments.service";

@Module({
  imports: [AuditModule],
  controllers: [SegmentsController],
  providers: [SegmentsService],
  exports: [SegmentsService],
})
export class SegmentsModule {}
