import { Injectable, Logger } from "@nestjs/common";
import { SupabaseService } from "@core/supabase/supabase.service";
import { AuditService } from "@domains/platform/audit/audit.service";
import { NotificationsService } from "./notifications.service";

type Row = Record<string, unknown>;

const PAGE_SIZE = 1000;
const DAY_MS = 86_400_000;

/**
 * The one in-app trigger with no in-band moment.
 *
 * Every other trigger fires from the function that records the event, so it
 * lands immediately. "Nothing has happened for N days" is a state rather than
 * an event, so there is nothing to hook and it has to be polled.
 *
 * The admin low-balance alert is also a state, but it is email-only by design,
 * so it stays entirely on the mailing enrollment cron.
 */
@Injectable()
export class NotificationsEnrollmentService {
  private readonly logger = new Logger(NotificationsEnrollmentService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService
  ) {}

  /** trigger_type -> trigger_params for the active message, if there is one. */
  private async activeParams(): Promise<Map<string, Record<string, unknown>>> {
    const { data, error } = await this.supabase.client
      .from("notification_messages")
      .select("trigger_type,trigger_params")
      .eq("kind", "trigger")
      .eq("status", "active");

    const out = new Map<string, Record<string, unknown>>();
    if (error || !data?.length) return out;
    for (const r of data as Row[]) {
      const trigger = typeof r.trigger_type === "string" ? r.trigger_type : "";
      if (!trigger) continue;
      out.set(
        trigger,
        typeof r.trigger_params === "object" &&
          r.trigger_params !== null &&
          !Array.isArray(r.trigger_params)
          ? (r.trigger_params as Record<string, unknown>)
          : {}
      );
    }
    return out;
  }

  private async loadUserCreatedAt(): Promise<Map<string, string>> {
    let offset = 0;
    const out = new Map<string, string>();
    for (;;) {
      const { data, error } = await this.supabase.client
        .from("users")
        .select("wallet_address,created_at")
        .order("wallet_address", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error || !data?.length) break;
      const rows = data as Row[];
      for (const r of rows) {
        const wallet =
          typeof r.wallet_address === "string" ? r.wallet_address.trim() : "";
        const createdAt = typeof r.created_at === "string" ? r.created_at : "";
        if (wallet && createdAt) out.set(wallet, createdAt);
      }
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return out;
  }

  /**
   * No recorded activity for `inactivity_days`.
   *
   * Unlike the mailing resolver this does not require a verified email: an
   * in-app notification only needs a wallet.
   *
   * The dedupe key is the wallet's last-activity timestamp, so each stretch of
   * inactivity produces exactly one notification. Once the user acts again the
   * timestamp moves, and a later lapse can notify afresh without a daily bucket
   * quietly re-notifying the same silence.
   */
  private async runInactivity(days: number): Promise<number> {
    const auditRows = await this.audit.query("wallet_address,created_at");
    const lastActivity = new Map<string, string>();
    for (const r of auditRows) {
      const wallet =
        typeof r.wallet_address === "string" ? r.wallet_address.trim() : "";
      const createdAt = typeof r.created_at === "string" ? r.created_at : "";
      if (!wallet || !createdAt) continue;
      const prev = lastActivity.get(wallet);
      if (!prev || createdAt > prev) lastActivity.set(wallet, createdAt);
    }

    const createdAtByWallet = await this.loadUserCreatedAt();
    const cutoff = Date.now() - days * DAY_MS;
    let emitted = 0;

    for (const [wallet, registeredAt] of createdAtByWallet) {
      const last = lastActivity.get(wallet) ?? registeredAt;
      const lastMs = new Date(last).getTime();
      if (!Number.isFinite(lastMs) || lastMs > cutoff) continue;

      await this.notifications.emit({
        trigger: "inactivity",
        walletAddress: wallet,
        dedupeKey: `inactivity:${last}`,
        params: { days },
      });
      emitted += 1;
    }
    return emitted;
  }

  async run(): Promise<{ emitted: number }> {
    const params = await this.activeParams();
    let emitted = 0;

    if (params.has("inactivity")) {
      const days = Number(params.get("inactivity")?.inactivity_days) || 14;
      try {
        emitted += await this.runInactivity(days);
      } catch (err) {
        this.logger.error(
          `inactivity notifications failed: ${(err as Error).message}`
        );
      }
    }

    return { emitted };
  }
}
