import { Module } from "@nestjs/common";
import { AdminAuthModule } from "../platform/admin-auth/admin-auth.module";
import { AccountsService } from "./accounts.service";
import {
  AdminApplicationsController,
  ApplicationsController,
} from "./applications.controller";
import { ApplicationsService } from "./applications.service";
import { DiditWebhookController } from "./didit-webhook.controller";
import { LaunchpadController } from "./launchpad.controller";
import { VerificationsService } from "./verifications.service";

@Module({
  imports: [AdminAuthModule],
  controllers: [
    LaunchpadController,
    DiditWebhookController,
    ApplicationsController,
    AdminApplicationsController,
  ],
  providers: [VerificationsService, AccountsService, ApplicationsService],
})
export class LaunchpadModule {}
