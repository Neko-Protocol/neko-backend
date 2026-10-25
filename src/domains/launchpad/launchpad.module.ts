import { Module } from "@nestjs/common";
import { AccountsService } from "./accounts.service";
import { DiditWebhookController } from "./didit-webhook.controller";
import { LaunchpadController } from "./launchpad.controller";
import { VerificationsService } from "./verifications.service";

@Module({
  controllers: [LaunchpadController, DiditWebhookController],
  providers: [VerificationsService, AccountsService],
})
export class LaunchpadModule {}
