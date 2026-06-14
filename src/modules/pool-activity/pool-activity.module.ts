import { Module } from "@nestjs/common";
import { PoolActivityController } from "./pool-activity.controller";
import { PoolActivityService } from "./pool-activity.service";

@Module({
  controllers: [PoolActivityController],
  providers: [PoolActivityService],
})
export class PoolActivityModule {}
