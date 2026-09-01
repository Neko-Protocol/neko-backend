import { Module } from "@nestjs/common";
import { NotificationsCoreModule } from "@domains/platform/notifications/notifications-core.module";
import { ReferralsModule } from "../referrals/referrals.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [ReferralsModule, NotificationsCoreModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
