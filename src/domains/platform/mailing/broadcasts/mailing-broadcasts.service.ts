import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmailService, EmailMessage } from "@core/email/email.service";
import { SupabaseService } from "@core/supabase/supabase.service";
import { MailingAudiencesService } from "../audiences/mailing-audiences.service";
import {
  AudienceId,
  isAudienceId,
  Recipient,
} from "../audiences/mailing-audiences.types";
import { MailingUnsubscribeTokenService } from "../unsubscribe/mailing-unsubscribe-token.service";
import { CreateMailingBroadcastDto } from "./dto/create-mailing-broadcast.dto";
import { UpdateMailingBroadcastDto } from "./dto/update-mailing-broadcast.dto";
import {
  MailingBroadcast,
  MailingBroadcastStatus,
} from "./mailing-broadcasts.types";

type Row = Record<string, unknown>;

const STATUS_ALLOWED: MailingBroadcastStatus[] = [
  "draft",
  "sending",
  "sent",
  "failed",
];

/** Matches EmailService's own Resend batch chunking. */
const SEND_CHUNK_SIZE = 50;

@Injectable()
export class MailingBroadcastsService {
  private readonly logger = new Logger(MailingBroadcastsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly email: EmailService,
    private readonly audiences: MailingAudiencesService,
    private readonly unsubscribeTokens: MailingUnsubscribeTokenService,
    private readonly config: ConfigService
  ) {}

  private mapRow(row: Row): MailingBroadcast | null {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) return null;

    const status = row.status as MailingBroadcastStatus;
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    return {
      id,
      name: String(row.name ?? ""),
      subject: String(row.subject ?? ""),
      body_html: String(row.body_html ?? ""),
      audience: typeof row.audience === "string" ? row.audience : "all",
      status: STATUS_ALLOWED.includes(status) ? status : "draft",
      recipient_count: num(row.recipient_count),
      sent_count: num(row.sent_count),
      failed_count: num(row.failed_count),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
      sent_at: typeof row.sent_at === "string" ? row.sent_at : null,
      created_by: row.created_by == null ? null : String(row.created_by),
      error: row.error == null ? null : String(row.error),
    };
  }

  private validateAudience(value: unknown): AudienceId {
    const audience = typeof value === "string" ? value : "all";
    if (!isAudienceId(audience)) {
      throw new BadRequestException({ code: "INVALID_AUDIENCE" });
    }
    return audience;
  }

  async list(): Promise<MailingBroadcast[]> {
    const { data, error } = await this.supabase.client
      .from("mailing_broadcasts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error || !data?.length) return [];

    const out: MailingBroadcast[] = [];
    for (const r of data as Row[]) {
      const b = this.mapRow(r);
      if (b) out.push(b);
    }
    return out;
  }

  async get(id: string): Promise<MailingBroadcast | null> {
    const { data, error } = await this.supabase.client
      .from("mailing_broadcasts")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data || typeof data !== "object") return null;
    return this.mapRow(data as Row);
  }

  private async getOrThrow(id: string): Promise<MailingBroadcast> {
    const broadcast = await this.get(id);
    if (!broadcast) throw new NotFoundException({ code: "NOT_FOUND" });
    return broadcast;
  }

  async create(body: CreateMailingBroadcastDto): Promise<MailingBroadcast> {
    const name = body.name.trim();
    const subject = body.subject.trim();
    if (!name || !subject) {
      throw new BadRequestException({ code: "NAME_AND_SUBJECT_REQUIRED" });
    }
    if (!body.body_html.trim()) {
      throw new BadRequestException({ code: "BODY_REQUIRED" });
    }
    const audience = this.validateAudience(body.audience);

    const { data: inserted, error } = await this.supabase.client
      .from("mailing_broadcasts")
      .insert({
        name,
        subject,
        body_html: body.body_html,
        audience,
        status: "draft",
        created_by: "admin",
      })
      .select("*")
      .maybeSingle();

    const broadcast = !error && inserted ? this.mapRow(inserted as Row) : null;
    if (!broadcast) {
      throw new BadRequestException({ code: "BROADCAST_CREATE_FAILED" });
    }
    return broadcast;
  }

  async update(
    id: string,
    body: UpdateMailingBroadcastDto
  ): Promise<MailingBroadcast> {
    const broadcast = await this.getOrThrow(id);
    if (broadcast.status !== "draft") {
      throw new BadRequestException({ code: "ONLY_DRAFT_EDITABLE" });
    }

    const payload: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const v = body.name.trim();
      if (!v) throw new BadRequestException({ code: "INVALID_NAME" });
      payload.name = v;
    }
    if (body.subject !== undefined) {
      const v = body.subject.trim();
      if (!v) throw new BadRequestException({ code: "INVALID_SUBJECT" });
      payload.subject = v;
    }
    if (body.body_html !== undefined) {
      if (!body.body_html.trim()) {
        throw new BadRequestException({ code: "BODY_REQUIRED" });
      }
      payload.body_html = body.body_html;
    }
    if (body.audience !== undefined) {
      payload.audience = this.validateAudience(body.audience);
    }

    if (Object.keys(payload).length) {
      const { error } = await this.supabase.client
        .from("mailing_broadcasts")
        .update(payload)
        .eq("id", id);
      if (error) {
        throw new BadRequestException({ code: "BROADCAST_UPDATE_FAILED" });
      }
    }

    return this.getOrThrow(id);
  }

  async remove(id: string): Promise<void> {
    const broadcast = await this.getOrThrow(id);
    if (broadcast.status !== "draft") {
      throw new BadRequestException({ code: "ONLY_DRAFT_DELETABLE" });
    }
    const { error } = await this.supabase.client
      .from("mailing_broadcasts")
      .delete()
      .eq("id", id);
    if (error) {
      throw new BadRequestException({ code: "BROADCAST_DELETE_FAILED" });
    }
  }

  /** Live recipient count for an audience, opt-outs already removed. */
  async previewAudience(
    audienceValue: unknown
  ): Promise<{ audience: AudienceId; count: number }> {
    const audience = this.validateAudience(audienceValue);
    const recipients = await this.audiences.getSendableRecipients(audience);
    return { audience, count: recipients.length };
  }

  private renderBody(bodyHtml: string, recipient: Recipient): string {
    const html = bodyHtml
      .replace(/\{\{\s*wallet_address\s*\}\}/gi, recipient.wallet_address ?? "")
      .replace(/\{\{\s*email\s*\}\}/gi, recipient.email);

    if (recipient.wallet_address === null) return html;
    if (!this.unsubscribeTokens.isConfigured) return html;

    try {
      const webAppUrl = (
        this.config.get<string>("WEB_APP_URL") ||
        "https://dapp.nekoprotocol.xyz"
      ).replace(/\/+$/, "");
      const token = this.unsubscribeTokens.sign(recipient.wallet_address);
      const url = `${webAppUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
      return `${html}<p style="margin-top:24px;font-size:12px;color:#888;">If you no longer want these emails, <a href="${url}">unsubscribe here</a>.</p>`;
    } catch {
      return html;
    }
  }

  /** Sends the composed broadcast to one address without touching send state. */
  async sendTest(id: string, to: string): Promise<{ ok: true }> {
    const broadcast = await this.getOrThrow(id);
    if (!this.email.isConfigured) {
      throw new BadRequestException({ code: "EMAIL_NOT_CONFIGURED" });
    }
    await this.email.sendStrict({
      to,
      subject: broadcast.subject,
      html: this.renderBody(broadcast.body_html, {
        email: to,
        wallet_address: null,
      }),
    });
    return { ok: true };
  }

  /**
   * Resolves the audience and sends. Chunks are attempted independently so one
   * bad batch degrades to a partial send with a recorded failure count rather
   * than losing the whole broadcast.
   */
  async send(id: string): Promise<MailingBroadcast> {
    const broadcast = await this.getOrThrow(id);
    if (broadcast.status !== "draft" && broadcast.status !== "failed") {
      throw new BadRequestException({ code: "ALREADY_SENT" });
    }
    if (!this.email.isConfigured) {
      throw new BadRequestException({ code: "EMAIL_NOT_CONFIGURED" });
    }

    const audience = this.validateAudience(broadcast.audience);
    const recipients = await this.audiences.getSendableRecipients(audience);
    if (!recipients.length) {
      throw new BadRequestException({ code: "AUDIENCE_EMPTY" });
    }

    // Claim the broadcast before sending so a concurrent call can't double-send.
    const { error: claimError } = await this.supabase.client
      .from("mailing_broadcasts")
      .update({
        status: "sending",
        recipient_count: recipients.length,
        error: null,
      })
      .eq("id", id)
      .in("status", ["draft", "failed"]);
    if (claimError) {
      throw new BadRequestException({ code: "BROADCAST_UPDATE_FAILED" });
    }

    const messages: EmailMessage[] = recipients.map((r) => ({
      to: r.email,
      subject: broadcast.subject,
      html: this.renderBody(broadcast.body_html, r),
    }));

    let sent = 0;
    let failed = 0;
    let firstError: string | null = null;

    for (let i = 0; i < messages.length; i += SEND_CHUNK_SIZE) {
      const chunk = messages.slice(i, i + SEND_CHUNK_SIZE);
      try {
        await this.email.sendBatch(chunk);
        sent += chunk.length;
      } catch (err) {
        failed += chunk.length;
        const message = (err as Error).message;
        if (!firstError) firstError = message;
        this.logger.warn(
          `broadcast ${id}: chunk at offset ${i} failed: ${message}`
        );
      }
    }

    const status: MailingBroadcastStatus = sent === 0 ? "failed" : "sent";
    const { error: finalError } = await this.supabase.client
      .from("mailing_broadcasts")
      .update({
        status,
        sent_count: sent,
        failed_count: failed,
        sent_at: new Date().toISOString(),
        error: firstError,
      })
      .eq("id", id);
    if (finalError) {
      throw new BadRequestException({ code: "BROADCAST_UPDATE_FAILED" });
    }

    this.logger.log(
      `broadcast ${id} finished: sent=${sent} failed=${failed} audience=${audience}`
    );
    return this.getOrThrow(id);
  }
}
