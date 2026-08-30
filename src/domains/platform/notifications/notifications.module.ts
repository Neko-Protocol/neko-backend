import { Module } from "@nestjs/common";
import { AuditModule } from "@domains/platform/audit/audit.module";
import { MailingAudiencesModule } from "@domains/platform/mailing/audiences/mailing-audiences.module";
import { NotificationAnnouncementService } from "./announcements/notification-announcement.service";
import { NotificationMessagesService } from "./messages/notification-messages.service";
import { NotificationsAdminController } from "./notifications-admin.controller";
import { NotificationsCoreModule } from "./notifications-core.module";
import { NotificationsEnrollmentCron } from "./notifications-enrollment.cron";
import { NotificationsEnrollmentService } from "./notifications-enrollment.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationStatsService } from "./stats/notification-stats.service";

/**
 * The admin surface and the polled triggers.
 *
 * The emit path itself lives in NotificationsCoreModule, which this imports and
 * which the event-producing domains import directly. Keeping them apart is what
 * lets this module depend on the mailing audience resolver without closing a
 * cycle back through AuditService.
 */
@Module({
  imports: [NotificationsCoreModule, MailingAudiencesModule, AuditModule],
  controllers: [NotificationsController, NotificationsAdminController],
  providers: [
    NotificationMessagesService,
    NotificationAnnouncementService,
    NotificationStatsService,
    NotificationsEnrollmentService,
    NotificationsEnrollmentCron,
  ],
})
export class NotificationsModule {}
