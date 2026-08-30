import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";

/**
 * The emit path on its own, with no dependency beyond Supabase.
 *
 * Kept separate from NotificationsModule so the domains that fire notifications
 * (audit, users, referrals) can import it without dragging in the mailing
 * audience resolver, which depends on AuditService and would close a cycle.
 */
@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsCoreModule {}
