import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmailService } from "@core/email/email.service";
import { SupabaseService } from "@core/supabase/supabase.service";
import { renderEmailHtml, unsubscribeHeaders } from "../email-render";
import { MailingUnsubscribeTokenService } from "../unsubscribe/mailing-unsubscribe-token.service";

const BATCH_LIMIT = 200;

type Row = Record<string, unknown>;

type DueSend = {
  id: string;
  message_id: string;
  wallet_address: string | null;
  email: string;
};

type MessageRow = {
  kind: string;
  status: string;
  template_id: string | null;
  subject: string | null;
  body_html: string | null;
};

type Content = { subject: string; body_html: string };

export type DispatchResult = { sent: number; skipped: number; failed: number };

/**
 * Sends whatever is due in `mailing_sends`, for both message kinds. Automations
 * are enrolled ahead of time by MailingEnrollmentService; broadcasts enqueue
 * their whole audience at send time and are dispatched immediately.
 */
@Injectable()
export class MailingDispatchService {
  private readonly logger = new Logger(MailingDispatchService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly email: EmailService,
    private readonly unsubscribeTokens: MailingUnsubscribeTokenService,
    private readonly config: ConfigService
  ) {}

  private substitute(
    text: string,
    vars: { wallet_address: string | null; email: string }
  ): string {
    return text
      .replace(/\{\{\s*wallet_address\s*\}\}/gi, vars.wallet_address ?? "")
      .replace(/\{\{\s*email\s*\}\}/gi, vars.email);
  }

  private get webAppUrl(): string {
    return (
      this.config.get<string>("WEB_APP_URL") || "https://dapp.nekoprotocol.xyz"
    ).replace(/\/+$/, "");
  }

  private unsubscribeUrlFor(walletAddress: string | null): string | null {
    if (walletAddress === null) return null;
    if (!this.unsubscribeTokens.isConfigured) return null;
    try {
      const token = this.unsubscribeTokens.sign(walletAddress);
      return `${this.webAppUrl}/api/unsubscribe?token=${encodeURIComponent(token)}`;
    } catch {
      return null;
    }
  }

  /** A message is sendable while active (automation) or sending (broadcast). */
  private isSendable(message: MessageRow): boolean {
    return message.kind === "automation"
      ? message.status === "active"
      : message.status === "sending";
  }

  async run(messageId?: string): Promise<DispatchResult> {
    const client = this.supabase.client;
    const nowIso = new Date().toISOString();

    let dueQuery = client
      .from("mailing_sends")
      .select("id,message_id,wallet_address,email")
      .eq("status", "pending")
      .lte("scheduled_send_at", nowIso)
      .order("scheduled_send_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (messageId) dueQuery = dueQuery.eq("message_id", messageId);

    const { data: dueData, error: dueError } = await dueQuery;
    if (dueError) throw new Error(dueError.message);

    const sends: DueSend[] = [];
    for (const r of (dueData ?? []) as Row[]) {
      const id = typeof r.id === "string" ? r.id : null;
      const message_id = typeof r.message_id === "string" ? r.message_id : null;
      const email = typeof r.email === "string" ? r.email : null;
      if (!id || !message_id || !email) continue;
      sends.push({
        id,
        message_id,
        wallet_address:
          typeof r.wallet_address === "string" ? r.wallet_address : null,
        email,
      });
    }
    if (!sends.length) return { sent: 0, skipped: 0, failed: 0 };

    const messagesById = await this.loadMessages([
      ...new Set(sends.map((s) => s.message_id)),
    ]);
    const contentById = await this.resolveContents(messagesById);
    const optedOut = await this.loadOptOuts(
      sends.map((s) => s.wallet_address).filter((w): w is string => w !== null)
    );

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const send of sends) {
      try {
        const message = messagesById.get(send.message_id);
        if (!message || !this.isSendable(message)) {
          await this.mark(send.id, "skipped", "message not sendable");
          skipped += 1;
          continue;
        }

        if (send.wallet_address && optedOut.has(send.wallet_address)) {
          await this.mark(send.id, "skipped", "recipient opted out");
          skipped += 1;
          continue;
        }

        const content = contentById.get(send.message_id);
        if (!content) {
          await this.mark(send.id, "failed", "content not found");
          failed += 1;
          continue;
        }

        const unsubscribeUrl = this.unsubscribeUrlFor(send.wallet_address);
        const headers = unsubscribeHeaders(unsubscribeUrl);

        try {
          await this.email.sendStrict({
            to: send.email,
            subject: this.substitute(content.subject, {
              wallet_address: send.wallet_address,
              email: send.email,
            }),
            html: renderEmailHtml({
              bodyHtml: content.body_html,
              email: send.email,
              walletAddress: send.wallet_address,
              unsubscribeUrl,
            }),
            ...(headers ? { headers } : {}),
          });
        } catch (err) {
          const message = (err as Error).message;
          this.logger.warn(`send ${send.id} failed: ${message}`);
          await this.mark(send.id, "failed", message);
          failed += 1;
          continue;
        }

        const { error } = await this.supabase.client
          .from("mailing_sends")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", send.id);
        if (error) throw new Error(error.message);
        sent += 1;
      } catch (err) {
        this.logger.warn(
          `unexpected error for send ${send.id}: ${(err as Error).message}`
        );
        failed += 1;
      }
    }

    return { sent, skipped, failed };
  }

  private async mark(
    id: string,
    status: "skipped" | "failed",
    error: string
  ): Promise<void> {
    const { error: updateError } = await this.supabase.client
      .from("mailing_sends")
      .update({ status, error })
      .eq("id", id);
    if (updateError) throw new Error(updateError.message);
  }

  private async loadMessages(ids: string[]): Promise<Map<string, MessageRow>> {
    const out = new Map<string, MessageRow>();
    if (!ids.length) return out;

    const { data, error } = await this.supabase.client
      .from("mailing_messages")
      .select("id,kind,status,template_id,subject,body_html")
      .in("id", ids);
    if (error) throw new Error(error.message);

    for (const r of (data ?? []) as Row[]) {
      const id = typeof r.id === "string" ? r.id : null;
      if (!id) continue;
      out.set(id, {
        kind: typeof r.kind === "string" ? r.kind : "",
        status: typeof r.status === "string" ? r.status : "",
        template_id: typeof r.template_id === "string" ? r.template_id : null,
        subject: typeof r.subject === "string" ? r.subject : null,
        body_html: typeof r.body_html === "string" ? r.body_html : null,
      });
    }
    return out;
  }

  /** Follows each message's template, falling back to its inline copy. */
  private async resolveContents(
    messagesById: Map<string, MessageRow>
  ): Promise<Map<string, Content>> {
    const templateIds = [
      ...new Set(
        [...messagesById.values()]
          .map((m) => m.template_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ];

    const templates = new Map<string, Content>();
    if (templateIds.length) {
      const { data, error } = await this.supabase.client
        .from("mailing_templates")
        .select("id,subject,body_html")
        .in("id", templateIds);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as Row[]) {
        const id = typeof r.id === "string" ? r.id : null;
        if (!id) continue;
        templates.set(id, {
          subject: typeof r.subject === "string" ? r.subject : "",
          body_html: typeof r.body_html === "string" ? r.body_html : "",
        });
      }
    }

    const out = new Map<string, Content>();
    for (const [id, message] of messagesById) {
      if (message.template_id) {
        const template = templates.get(message.template_id);
        if (template) out.set(id, template);
        continue;
      }
      if (message.subject !== null && message.body_html !== null) {
        out.set(id, {
          subject: message.subject,
          body_html: message.body_html,
        });
      }
    }
    return out;
  }

  private async loadOptOuts(wallets: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    if (!wallets.length) return out;

    const { data, error } = await this.supabase.client
      .from("mailing_opt_outs")
      .select("wallet_address")
      .in("wallet_address", wallets);
    if (error) throw new Error(error.message);

    for (const r of (data ?? []) as Row[]) {
      if (typeof r.wallet_address === "string") out.add(r.wallet_address);
    }
    return out;
  }
}
