import { Module } from "@nestjs/common";
import { InvitationsModule } from "../invitations/invitations.module";
import { AdminStrategiesController } from "./admin-strategies.controller";
import { AdminStrategiesService } from "./admin-strategies.service";

@Module({
  imports: [InvitationsModule],
  controllers: [AdminStrategiesController],
  providers: [AdminStrategiesService],
})
export class AdminStrategiesModule {}
