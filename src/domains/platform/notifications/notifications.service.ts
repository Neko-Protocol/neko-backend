import { Injectable, Logger } from "@nestjs/common";
import { SupabaseService } from "@core/supabase/supabase.service";
import { PushService } from "./push/push.service";
import {
  EmitNotificationInput,
  Notification,
  NotificationCategory,
} from "./notifications.types";

type Row = Record<string, unknown>;

const LIST_LIMIT = 50;

/** Page size when reading depositors, under PostgREST's default row cap. */
const DEPOSITORS_PAGE = 1000;

/** Substitutes `{{name}}` placeholders with caller-supplied params. */
function substitute(
  text: string,
  params: Record<string, string | number> | undefined
): string {
  if (!params) return text;
  return text.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

function toCategory(raw: unknown): NotificationCategory {
  return raw === "reward" || raw === "system" || raw === "alert"
    ? raw
    : "activity";
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly push: PushService
  ) {}

  /**
   * Writes one in-app notification, in-band with the event that caused it.
   *
   * Called from the backend function that records the event (an audit write, a
   * user registration, a referral confirmation) rather than from a cron, so the
   * bell updates as soon as the action lands. The matching email still goes out
   * later on the mailing dispatch schedule; the two channels are independent.
   *
   * Deliberately depends on nothing but Supabase. Resolving an audience here
   * would pull in MailingAudiencesService, which depends on AuditService, which
   * calls this - a module cycle. Trigger notifications need no audience anyway:
   * the trigger already identifies the recipient by their own action. Audiences
   * apply to announcements, which fan out from the admin module instead.
   *
   * Never throws. A notification failing must not break the user action that
   * produced it, so callers can invoke this without a try/catch of their own.
   */
  async emit(input: EmitNotificationInput): Promise<void> {
    try {
      const wallet = input.walletAddress?.trim();
      const dedupeKey = input.dedupeKey?.trim();
      if (!wallet || !dedupeKey) return;

      const { data, error } = await this.supabase.client
        .from("notification_messages")
        .select("id,title,body,url,category")
        .eq("kind", "trigger")
        .eq("trigger_type", input.trigger)
        .eq("status", "active")
        .maybeSingle();

      // No active message for this trigger is the normal state until an admin
      // configures one, so it is not worth a log line.
      if (error || !data) return;

      const row = data as Row;
      const title = substitute(String(row.title ?? ""), input.params);
      const body = substitute(String(row.body ?? ""), input.params);
      const created = await this.insert({
        wallet_address: wallet,
        message_id: typeof row.id === "string" ? row.id : null,
        title,
        body,
        url: row.url == null ? null : String(row.url),
        category: toCategory(row.category),
        trigger_type: input.trigger,
        dedupe_key: dedupeKey,
      });

      // Push is the third channel, with the same text as the in-app item. Only
      // a new row is pushed, so the dedupe key also keeps pushes from repeating.
      // Not awaited: the user action that fired emit() shouldn't wait on Expo.
      if (created > 0) {
        void this.push.sendToWallet(wallet, {
          title,
          body,
          data: { trigger: input.trigger },
        });
      }
    } catch (err) {
      this.logger.warn(
        `[notifications] emit failed for ${input.trigger}: ${(err as Error).message}`
      );
    }
  }

  /**
   * Wallets that deposited into a vault, or into any vault when `vaultId` is
   * omitted. Read from audit_logs, where a vault deposit records the vault
   * contract id as pool_id. A wallet that later withdrew everything is still
   * included.
   */
  async vaultDepositors(vaultId?: string): Promise<string[]> {
    const wallets = new Set<string>();
    for (let from = 0; ; from += DEPOSITORS_PAGE) {
      let query = this.supabase.client
        .from("audit_logs")
        .select("wallet_address")
        .eq("action_type", "vaults_deposit");
      if (vaultId) query = query.eq("pool_id", vaultId);
      const { data, error } = await query.range(
        from,
        from + DEPOSITORS_PAGE - 1
      );
      if (error) throw new Error(error.message);

      const rows = (data ?? []) as { wallet_address?: unknown }[];
      for (const row of rows) {
        if (typeof row.wallet_address === "string" && row.wallet_address) {
          wallets.add(row.wallet_address);
        }
      }
      if (rows.length < DEPOSITORS_PAGE) break;
    }
    return [...wallets];
  }

  /**
   * Inserts delivered rows, ignoring anything that collides with an existing
   * (wallet_address, dedupe_key). That unique constraint is what lets emit() be
   * called unconditionally from hot paths without a read-modify-write.
   *
   * Returns the number of rows that were actually new.
   */
  async insert(rows: Row | Row[]): Promise<number> {
    const list = Array.isArray(rows) ? rows : [rows];
    if (!list.length) return 0;

    const { data, error } = await this.supabase.client
      .from("notifications")
      .upsert(list, {
        onConflict: "wallet_address,dedupe_key",
        ignoreDuplicates: true,
      })
      .select("id");

    if (error) throw new Error(error.message);
    return data?.length ?? 0;
  }

  private mapRow(row: Row): Notification | null {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) return null;
    return {
      id,
      title: String(row.title ?? ""),
      body: String(row.body ?? ""),
      url: row.url == null ? null : String(row.url),
      category: toCategory(row.category),
      trigger_type: row.trigger_type == null ? null : String(row.trigger_type),
      read_at: row.read_at == null ? null : String(row.read_at),
      created_at: String(row.created_at ?? ""),
    };
  }

  async list(
    wallet: string,
    limit = LIST_LIMIT
  ): Promise<{ items: Notification[]; unread: number }> {
    const address = wallet?.trim();
    if (!address) return { items: [], unread: 0 };

    const capped = Math.min(Math.max(limit, 1), LIST_LIMIT);
    const [listResult, unread] = await Promise.all([
      this.supabase.client
        .from("notifications")
        .select("*")
        .eq("wallet_address", address)
        .is("cleared_at", null)
        .order("created_at", { ascending: false })
        .limit(capped),
      this.unreadCount(address),
    ]);

    const { data, error } = listResult;
    if (error || !data?.length) return { items: [], unread };

    const items: Notification[] = [];
    for (const r of data as Row[]) {
      const n = this.mapRow(r);
      if (n) items.push(n);
    }
    return { items, unread };
  }

  async unreadCount(wallet: string): Promise<number> {
    const address = wallet?.trim();
    if (!address) return 0;
    const { count, error } = await this.supabase.client
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("wallet_address", address)
      .is("read_at", null)
      .is("cleared_at", null);
    return error ? 0 : (count ?? 0);
  }

  /** Marks the given ids read. Scoped to the wallet so ids cannot be guessed. */
  async markRead(wallet: string, ids: string[]): Promise<{ updated: number }> {
    const address = wallet?.trim();
    const unique = [...new Set(ids.filter((id) => typeof id === "string"))];
    if (!address || !unique.length) return { updated: 0 };

    const { data, error } = await this.supabase.client
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("wallet_address", address)
      .is("read_at", null)
      .in("id", unique)
      .select("id");

    if (error) return { updated: 0 };
    return { updated: data?.length ?? 0 };
  }

  async markAllRead(wallet: string): Promise<{ updated: number }> {
    const address = wallet?.trim();
    if (!address) return { updated: 0 };

    const { data, error } = await this.supabase.client
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("wallet_address", address)
      .is("read_at", null)
      .select("id");

    if (error) return { updated: 0 };
    return { updated: data?.length ?? 0 };
  }

  /**
   * Clearing stamps `cleared_at` instead of deleting.
   *
   * The row is what makes a first-time-only trigger first-time-only - the
   * unique (wallet_address, dedupe_key) - so a delete would let 'first_deposit'
   * fire again for someone who had merely tidied their tray. Both the feed and
   * the badge already skip cleared rows, so read_at is left alone rather than
   * overwritten with a timestamp the user never actually read anything at.
   */
  async clear(wallet: string, ids: string[]): Promise<{ cleared: number }> {
    const address = wallet?.trim();
    const unique = [...new Set(ids.filter((id) => typeof id === "string"))];
    if (!address || !unique.length) return { cleared: 0 };

    const { data, error } = await this.supabase.client
      .from("notifications")
      .update({ cleared_at: new Date().toISOString() })
      .eq("wallet_address", address)
      .is("cleared_at", null)
      .in("id", unique)
      .select("id");

    if (error) return { cleared: 0 };
    return { cleared: data?.length ?? 0 };
  }

  async clearAll(wallet: string): Promise<{ cleared: number }> {
    const address = wallet?.trim();
    if (!address) return { cleared: 0 };

    const { data, error } = await this.supabase.client
      .from("notifications")
      .update({ cleared_at: new Date().toISOString() })
      .eq("wallet_address", address)
      .is("cleared_at", null)
      .select("id");

    if (error) return { cleared: 0 };
    return { cleared: data?.length ?? 0 };
  }
}
