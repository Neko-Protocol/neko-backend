import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SupabaseService } from "@core/supabase/supabase.service";
import { MailingAudiencesService } from "../audiences/mailing-audiences.service";
import { AudienceId, isAudienceId } from "../audiences/mailing-audiences.types";
import { isTriggerType } from "../mailing-triggers.types";
import { MailingTemplatesService } from "../templates/mailing-templates.service";
import { CreateMailingMessageDto } from "./dto/create-mailing-message.dto";
import { UpdateMailingMessageDto } from "./dto/update-mailing-message.dto";
import {
  AUTOMATION_TRANSITIONS,
  isDelayUnit,
  isMessageKind,
  MailingDelayUnit,
  MailingMessage,
  MailingMessageKind,
  MailingMessageStatus,
  MailingSend,
  MailingSendStats,
} from "./mailing-messages.types";

type Row = Record<string, unknown>;

const STATUSES: MailingMessageStatus[] = [
  "draft",
  "active",
  "paused",
  "archived",
  "sending",
  "sent",
  "failed",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Subject + body actually sent, resolved from a template or inline copy. */
export type ResolvedContent = { subject: string; body_html: string };

@Injectable()
export class MailingMessagesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly templates: MailingTemplatesService,
    private readonly audiences: MailingAudiencesService
  ) {}

  private mapRow(row: Row): MailingMessage | null {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) return null;

    const status = row.status as MailingMessageStatus;
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    return {
      id,
      kind: row.kind === "automation" ? "automation" : "broadcast",
      name: String(row.name ?? ""),
      template_id: typeof row.template_id === "string" ? row.template_id : null,
      subject: typeof row.subject === "string" ? row.subject : null,
      body_html: typeof row.body_html === "string" ? row.body_html : null,
      audience: typeof row.audience === "string" ? row.audience : "all",
      trigger_type:
        typeof row.trigger_type === "string" ? row.trigger_type : null,
      trigger_params: isPlainObject(row.trigger_params)
        ? row.trigger_params
        : {},
      delay_value: num(row.delay_value),
      delay_unit: isDelayUnit(row.delay_unit)
        ? row.delay_unit
        : ("days" as MailingDelayUnit),
      status: STATUSES.includes(status) ? status : "draft",
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

  /**
   * Content must resolve to a real subject and body. A template reference wins
   * when present; otherwise the inline copy must be complete.
   */
  private async validateContent(input: {
    template_id?: string;
    subject?: string;
    body_html?: string;
  }): Promise<void> {
    if (input.template_id) {
      const template = await this.templates.get(input.template_id);
      if (!template) {
        throw new BadRequestException({ code: "INVALID_TEMPLATE" });
      }
      return;
    }
    if (!input.subject?.trim() || !input.body_html?.trim()) {
      throw new BadRequestException({ code: "CONTENT_REQUIRED" });
    }
  }

  async list(kind?: MailingMessageKind): Promise<MailingMessage[]> {
    let query = this.supabase.client
      .from("mailing_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (kind) query = query.eq("kind", kind);

    const { data, error } = await query;
    if (error || !data?.length) return [];

    const out: MailingMessage[] = [];
    for (const r of data as Row[]) {
      const m = this.mapRow(r);
      if (m) out.push(m);
    }
    return out;
  }

  async get(id: string): Promise<MailingMessage | null> {
    const { data, error } = await this.supabase.client
      .from("mailing_messages")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data || typeof data !== "object") return null;
    return this.mapRow(data as Row);
  }

  async getOrThrow(id: string): Promise<MailingMessage> {
    const message = await this.get(id);
    if (!message) throw new NotFoundException({ code: "NOT_FOUND" });
    return message;
  }

  /** Resolves a message's content, following its template when it has one. */
  async resolveContent(message: MailingMessage): Promise<ResolvedContent> {
    if (message.template_id) {
      const template = await this.templates.get(message.template_id);
      if (!template) {
        throw new BadRequestException({ code: "INVALID_TEMPLATE" });
      }
      return { subject: template.subject, body_html: template.body_html };
    }
    return {
      subject: message.subject ?? "",
      body_html: message.body_html ?? "",
    };
  }

  async create(body: CreateMailingMessageDto): Promise<MailingMessage> {
    if (!isMessageKind(body.kind)) {
      throw new BadRequestException({ code: "INVALID_KIND" });
    }
    const name = body.name.trim();
    if (!name) throw new BadRequestException({ code: "NAME_REQUIRED" });

    const audience = this.validateAudience(body.audience);
    await this.validateContent(body);

    // The trigger is what makes a message an automation, so it's required on
    // one kind and rejected on the other rather than merely ignored.
    if (body.kind === "automation") {
      if (!isTriggerType(body.trigger_type)) {
        throw new BadRequestException({ code: "INVALID_TRIGGER_TYPE" });
      }
    } else if (body.trigger_type) {
      throw new BadRequestException({ code: "BROADCAST_CANNOT_TRIGGER" });
    }

    let delay_unit: MailingDelayUnit = "days";
    if (body.delay_unit !== undefined) {
      if (!isDelayUnit(body.delay_unit)) {
        throw new BadRequestException({ code: "INVALID_DELAY_UNIT" });
      }
      delay_unit = body.delay_unit;
    }

    const delay_value =
      body.delay_value !== undefined ? Number(body.delay_value) : 0;
    if (!Number.isFinite(delay_value) || delay_value < 0) {
      throw new BadRequestException({ code: "INVALID_DELAY_VALUE" });
    }

    const { data: inserted, error } = await this.supabase.client
      .from("mailing_messages")
      .insert({
        kind: body.kind,
        name,
        template_id: body.template_id ?? null,
        subject: body.subject?.trim() ?? null,
        body_html: body.body_html ?? null,
        audience,
        trigger_type: body.kind === "automation" ? body.trigger_type : null,
        trigger_params: isPlainObject(body.trigger_params)
          ? body.trigger_params
          : {},
        delay_value,
        delay_unit,
        status: "draft",
        created_by: await this.audiences.resolveCreatedBy(body.created_by),
      })
      .select("*")
      .maybeSingle();

    const message = !error && inserted ? this.mapRow(inserted as Row) : null;
    if (!message) {
      throw new BadRequestException({ code: "MESSAGE_CREATE_FAILED" });
    }
    return message;
  }

  async update(
    id: string,
    body: UpdateMailingMessageDto
  ): Promise<MailingMessage> {
    const message = await this.getOrThrow(id);

    // A broadcast is only editable before it goes out; an automation can also
    // be edited while paused.
    const editable =
      message.kind === "broadcast"
        ? message.status === "draft" || message.status === "failed"
        : message.status === "draft" || message.status === "paused";
    if (!editable) {
      throw new BadRequestException({ code: "NOT_EDITABLE" });
    }

    const payload: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const v = body.name.trim();
      if (!v) throw new BadRequestException({ code: "NAME_REQUIRED" });
      payload.name = v;
    }
    if (body.audience !== undefined) {
      payload.audience = this.validateAudience(body.audience);
    }
    if (
      body.template_id !== undefined ||
      body.subject !== undefined ||
      body.body_html !== undefined
    ) {
      const template_id =
        body.template_id !== undefined
          ? body.template_id
          : (message.template_id ?? undefined);
      const subject =
        body.subject !== undefined
          ? body.subject
          : (message.subject ?? undefined);
      const body_html =
        body.body_html !== undefined
          ? body.body_html
          : (message.body_html ?? undefined);
      await this.validateContent({ template_id, subject, body_html });
      if (body.template_id !== undefined) {
        payload.template_id = body.template_id || null;
      }
      if (body.subject !== undefined) payload.subject = body.subject || null;
      if (body.body_html !== undefined) {
        payload.body_html = body.body_html || null;
      }
    }
    if (body.trigger_type !== undefined) {
      if (message.kind !== "automation") {
        throw new BadRequestException({ code: "BROADCAST_CANNOT_TRIGGER" });
      }
      if (!isTriggerType(body.trigger_type)) {
        throw new BadRequestException({ code: "INVALID_TRIGGER_TYPE" });
      }
      payload.trigger_type = body.trigger_type;
    }
    if (body.trigger_params !== undefined) {
      payload.trigger_params = isPlainObject(body.trigger_params)
        ? body.trigger_params
        : {};
    }
    if (body.delay_unit !== undefined) {
      if (!isDelayUnit(body.delay_unit)) {
        throw new BadRequestException({ code: "INVALID_DELAY_UNIT" });
      }
      payload.delay_unit = body.delay_unit;
    }
    if (body.delay_value !== undefined) {
      const delay_value = Number(body.delay_value);
      if (!Number.isFinite(delay_value) || delay_value < 0) {
        throw new BadRequestException({ code: "INVALID_DELAY_VALUE" });
      }
      payload.delay_value = delay_value;
    }

    if (Object.keys(payload).length) {
      const { error } = await this.supabase.client
        .from("mailing_messages")
        .update(payload)
        .eq("id", id);
      if (error) {
        throw new BadRequestException({ code: "MESSAGE_UPDATE_FAILED" });
      }
    }

    return this.getOrThrow(id);
  }

  async setStatus(
    id: string,
    status: MailingMessageStatus
  ): Promise<MailingMessage> {
    const message = await this.getOrThrow(id);
    if (message.kind !== "automation") {
      throw new BadRequestException({ code: "NOT_AN_AUTOMATION" });
    }

    const allowed = AUTOMATION_TRANSITIONS[message.status] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException({ code: "INVALID_STATUS_TRANSITION" });
    }

    const { error } = await this.supabase.client
      .from("mailing_messages")
      .update({ status })
      .eq("id", id);
    if (error) {
      throw new BadRequestException({ code: "MESSAGE_UPDATE_FAILED" });
    }
    return this.getOrThrow(id);
  }

  async remove(id: string): Promise<void> {
    const message = await this.getOrThrow(id);
    if (message.status !== "draft") {
      throw new BadRequestException({ code: "ONLY_DRAFT_DELETABLE" });
    }
    const { error } = await this.supabase.client
      .from("mailing_messages")
      .delete()
      .eq("id", id);
    if (error) {
      throw new BadRequestException({ code: "MESSAGE_DELETE_FAILED" });
    }
  }

  async listSends(id: string, limit = 100): Promise<MailingSend[]> {
    const { data, error } = await this.supabase.client
      .from("mailing_sends")
      .select("*")
      .eq("message_id", id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data?.length) return [];

    const out: MailingSend[] = [];
    for (const r of data as Row[]) {
      const rowId = typeof r.id === "string" ? r.id : null;
      if (!rowId) continue;
      out.push({
        id: rowId,
        wallet_address:
          typeof r.wallet_address === "string" ? r.wallet_address : null,
        email: String(r.email ?? ""),
        trigger_at: typeof r.trigger_at === "string" ? r.trigger_at : null,
        scheduled_send_at: String(r.scheduled_send_at ?? ""),
        status: String(r.status ?? ""),
        sent_at: typeof r.sent_at === "string" ? r.sent_at : null,
        error: r.error == null ? null : String(r.error),
      });
    }
    return out;
  }

  async getSendStats(id: string): Promise<MailingSendStats> {
    const client = this.supabase.client;
    const countFor = (status?: string) => {
      let q = client
        .from("mailing_sends")
        .select("*", { count: "exact", head: true })
        .eq("message_id", id);
      if (status) q = q.eq("status", status);
      return q;
    };

    const [enrolled, pending, sent, skipped, failed] = await Promise.all([
      countFor(),
      countFor("pending"),
      countFor("sent"),
      countFor("skipped"),
      countFor("failed"),
    ]);

    return {
      enrolled: enrolled.count ?? 0,
      pending: pending.count ?? 0,
      sent: sent.count ?? 0,
      skipped: skipped.count ?? 0,
      failed: failed.count ?? 0,
    };
  }
}
