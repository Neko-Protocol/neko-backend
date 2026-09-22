import { Injectable } from "@nestjs/common";
import type {
  NotificationStats,
  NotificationTriggerCoverage,
} from "@neko-protocol/api-contracts";
import { SupabaseService } from "@core/supabase/supabase.service";
import { NOTIFICATION_TRIGGERS } from "../notifications.types";

type Row = Record<string, unknown>;

@Injectable()
export class NotificationStatsService {
  constructor(private readonly supabase: SupabaseService) {}

  private async count(
    table: string,
    apply: (q: any) => any = (q) => q
  ): Promise<number> {
    const query = apply(
      this.supabase.client.from(table).select("id", {
        count: "exact",
        head: true,
      })
    );
    const { count, error } = await query;
    return error ? 0 : (count ?? 0);
  }

  /**
   * Per-trigger channel coverage: whether an active in-app message and an
   * active email automation both exist.
   *
   * This is what the admin Triggers tab renders, and the reason it lives here
   * rather than in either channel's own module: the requirement is that every
   * trigger reaches people both ways, which neither table can answer alone.
   */
  async coverage(): Promise<NotificationTriggerCoverage[]> {
    // Archived messages are excluded: they are retired on purpose, so surfacing
    // one would read as "configured" when nothing will ever fire.
    const [notifResult, mailResult] = await Promise.all([
      this.supabase.client
        .from("notification_messages")
        .select("id,trigger_type,status,updated_at")
        .eq("kind", "trigger")
        .neq("status", "archived")
        .order("updated_at", { ascending: false }),
      this.supabase.client
        .from("mailing_messages")
        .select("id,trigger_type,status,updated_at")
        .eq("kind", "automation")
        .neq("status", "archived")
        .order("updated_at", { ascending: false }),
    ]);

    /**
     * One message per trigger: the active one if there is one, otherwise the
     * most recently touched draft or paused row, which is what an admin who
     * started the job and stopped halfway would expect to see named.
     */
    const byTrigger = (result: { data: unknown }) => {
      const map = new Map<string, { id: string; status: string }>();
      for (const r of (result.data as Row[] | null) ?? []) {
        const trigger =
          typeof r.trigger_type === "string" ? r.trigger_type : null;
        const id = typeof r.id === "string" ? r.id : null;
        const status = typeof r.status === "string" ? r.status : "draft";
        if (!trigger || !id) continue;

        const existing = map.get(trigger);
        if (
          !existing ||
          (status === "active" && existing.status !== "active")
        ) {
          map.set(trigger, { id, status });
        }
      }
      return map;
    };

    const notifs = byTrigger(notifResult);
    const mails = byTrigger(mailResult);

    return NOTIFICATION_TRIGGERS.map((t) => {
      const notif = notifs.get(t.id) ?? null;
      const mail = mails.get(t.id) ?? null;
      return {
        id: t.id,
        label: t.label,
        description: t.description,
        hasNotification: notif?.status === "active",
        hasEmail: mail?.status === "active",
        notificationMessageId: notif?.id ?? null,
        emailMessageId: mail?.id ?? null,
        notificationStatus: notif?.status ?? null,
        emailStatus: mail?.status ?? null,
        inAppSupported: t.inAppSupported,
        placeholders: [...t.placeholders],
      };
    });
  }

  async stats(): Promise<NotificationStats> {
    const [delivered, unread, activeTriggers, announcementsSent, coverage] =
      await Promise.all([
        this.count("notifications"),
        this.count("notifications", (q) => q.is("read_at", null)),
        this.count("notification_messages", (q) =>
          q.eq("kind", "trigger").eq("status", "active")
        ),
        this.count("notification_messages", (q) =>
          q.eq("kind", "announcement").eq("status", "sent")
        ),
        this.coverage(),
      ]);

    return {
      delivered,
      read: delivered - unread,
      unread,
      activeTriggers,
      announcementsSent,
      // Configured on one channel but not the other. Zero is the goal state.
      // Email-only triggers are excluded: a missing in-app half is the design
      // there, not a gap, and counting it would make the goal unreachable.
      incompleteTriggers: coverage.filter(
        (c) => c.inAppSupported && c.hasNotification !== c.hasEmail
      ).length,
    };
  }
}
