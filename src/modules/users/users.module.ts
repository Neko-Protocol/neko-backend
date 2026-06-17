import { Module } from "@nestjs/common";
import { ReferralsModule } from "../referrals/referrals.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [ReferralsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
