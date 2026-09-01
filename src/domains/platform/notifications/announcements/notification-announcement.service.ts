import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { SupabaseService } from "@core/supabase/supabase.service";
import { MailingAudiencesService } from "@domains/platform/mailing/audiences/mailing-audiences.service";
import { isAudienceId } from "@domains/platform/mailing/audiences/mailing-audiences.types";
import { NotificationMessagesService } from "../messages/notification-messages.service";
import { NotificationsService } from "../notifications.service";

type Row = Record<string, unknown>;

const PAGE_SIZE = 1000;
const CHUNK_SIZE = 500;

@Injectable()
export class NotificationAnnouncementService {
  private readonly logger = new Logger(NotificationAnnouncementService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly audiences: MailingAudiencesService,
    private readonly messages: NotificationMessagesService,
    private readonly notifications: NotificationsService
  ) {}

  /**
   * Every wallet that has ever registered.
   *
   * Deliberately not `MailingAudiencesService.getRecipients("all")`, which
   * filters on a verified email because email is its only channel. An in-app
   * notification needs nothing but a wallet, so gating it on email would
   * silently drop most of the audience.
   */
  private async getAllWallets(): Promise<string[]> {
    let offset = 0;
    const out: string[] = [];
    for (;;) {
      const { data, error } = await this.supabase.client
        .from("users")
        .select("wallet_address")
        .order("wallet_address", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error || !data?.length) break;
      const rows = data as Row[];
      for (const r of rows) {
        const wallet =
          typeof r.wallet_address === "string" ? r.wallet_address.trim() : "";
        if (wallet) out.push(wallet);
      }
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return out;
  }

  async resolveWallets(audience: string): Promise<string[]> {
    if (audience === "all") return this.getAllWallets();
    if (!isAudienceId(audience)) return [];

    const recipients = await this.audiences.getRecipients(audience);
    return [
      ...new Set(
        recipients
          .map((r) => r.wallet_address)
          .filter((w): w is string => typeof w === "string" && w.length > 0)
      ),
    ];
  }

  /** Recipient count for the composer, before anything is sent. */
  async preview(
    audience: string
  ): Promise<{ audience: string; count: number }> {
    const wallets = await this.resolveWallets(audience);
    return { audience, count: wallets.length };
  }

  /**
   * Fans an announcement out to its audience.
   *
   * The dedupe key is the message id, so a retry after a partial failure
   * inserts only the rows that never landed rather than duplicating the ones
   * that did.
   */
  async send(id: string): Promise<{ sent: number }> {
    const message = await this.messages.get(id);
    if (!message) throw new NotFoundException({ code: "NOT_FOUND" });
    if (message.kind !== "announcement") {
      throw new BadRequestException({ code: "NOT_AN_ANNOUNCEMENT" });
    }

    const wallets = await this.resolveWallets(message.audience);
    if (!wallets.length) {
      throw new BadRequestException({ code: "AUDIENCE_EMPTY" });
    }

    const dedupeKey = `announcement:${message.id}`;
    let sent = 0;

    for (let i = 0; i < wallets.length; i += CHUNK_SIZE) {
      const chunk = wallets.slice(i, i + CHUNK_SIZE).map((wallet) => ({
        wallet_address: wallet,
        message_id: message.id,
        title: message.title,
        body: message.body,
        url: message.url,
        category: message.category,
        trigger_type: null,
        dedupe_key: dedupeKey,
      }));

      try {
        sent += await this.notifications.insert(chunk);
      } catch (err) {
        this.logger.error(
          `announcement ${message.id} chunk failed: ${(err as Error).message}`
        );
        throw new BadRequestException({ code: "ANNOUNCEMENT_SEND_FAILED" });
      }
    }

    await this.supabase.client
      .from("notification_messages")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        sent_count: message.sent_count + sent,
      })
      .eq("id", message.id);

    return { sent };
  }
}
