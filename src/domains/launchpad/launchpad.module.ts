import { Module } from "@nestjs/common";
import { AdminAuthModule } from "../platform/admin-auth/admin-auth.module";
import { AccountsService } from "./accounts.service";
import {
  AdminApplicationsController,
  ApplicationsController,
} from "./applications.controller";
import { ApplicationsService } from "./applications.service";
import { AssistantStorageService } from "./assistant/assistant-storage.service";
import { AssistantController } from "./assistant/assistant.controller";
import { AssistantService } from "./assistant/assistant.service";
import { RagClient } from "./assistant/rag.client";
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
    AssistantController,
  ],
  providers: [
    VerificationsService,
    AccountsService,
    ApplicationsService,
    AssistantService,
    AssistantStorageService,
    RagClient,
  ],
})
export class LaunchpadModule {}
