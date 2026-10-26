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
import { InvestorsController } from "./investors.controller";
import { InvestorsService } from "./investors.service";
import { LaunchpadController } from "./launchpad.controller";
import { ProIdentityService } from "./pro-identity.service";
import { VerificationsService } from "./verifications.service";

@Module({
  imports: [AdminAuthModule],
  controllers: [
    LaunchpadController,
    DiditWebhookController,
    ApplicationsController,
    AdminApplicationsController,
    AssistantController,
    InvestorsController,
  ],
  providers: [
    VerificationsService,
    AccountsService,
    InvestorsService,
    ProIdentityService,
    ApplicationsService,
    AssistantService,
    AssistantStorageService,
    RagClient,
  ],
})
export class LaunchpadModule {}
