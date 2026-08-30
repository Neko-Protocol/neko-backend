import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SupabaseService } from "@core/supabase/supabase.service";
import { MailingAudiencesService } from "@domains/platform/mailing/audiences/mailing-audiences.service";
import { CreateNotificationMessageDto } from "./dto/create-notification-message.dto";
import { UpdateNotificationMessageDto } from "./dto/update-notification-message.dto";
import {
  NotificationMessage,
  NotificationMessageStatus,
  supportsInApp,
} from "../notifications.types";

type Row = Record<string, unknown>;

/** Postgres unique-violation, raised by the one-active-message-per-trigger index. */
const UNIQUE_VIOLATION = "23505";

@Injectable()
export class NotificationMessagesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audiences: MailingAudiencesService
  ) {}

  private mapRow(row: Row): NotificationMessage | null {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) return null;

    return {
      id,
      kind: row.kind === "announcement" ? "announcement" : "trigger",
      name: String(row.name ?? ""),
      title: String(row.title ?? ""),
      body: String(row.body ?? ""),
      url: row.url == null ? null : String(row.url),
      category: (row.category ?? "activity") as NotificationMessage["category"],
      audience: (row.audience ?? "all") as NotificationMessage["audience"],
      trigger_type: (row.trigger_type ??
        null) as NotificationMessage["trigger_type"],
      trigger_params:
        typeof row.trigger_params === "object" &&
        row.trigger_params !== null &&
        !Array.isArray(row.trigger_params)
          ? (row.trigger_params as Record<string, unknown>)
          : {},
      status: (row.status ?? "draft") as NotificationMessageStatus,
      sent_count: Number(row.sent_count ?? 0),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
      sent_at: row.sent_at == null ? null : String(row.sent_at),
      created_by: row.created_by == null ? null : String(row.created_by),
    };
  }

  async list(kind?: string): Promise<NotificationMessage[]> {
    let query = this.supabase.client
      .from("notification_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (kind === "trigger" || kind === "announcement") {
      query = query.eq("kind", kind);
    }

    const { data, error } = await query;
    if (error || !data?.length) return [];

    const out: NotificationMessage[] = [];
    for (const r of data as Row[]) {
      const m = this.mapRow(r);
      if (m) out.push(m);
    }
    return out;
  }

  async get(id: string): Promise<NotificationMessage | null> {
    const { data, error } = await this.supabase.client
      .from("notification_messages")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data || typeof data !== "object") return null;
    return this.mapRow(data as Row);
  }

  async create(
    body: CreateNotificationMessageDto
  ): Promise<NotificationMessage> {
    const name = body.name.trim();
    const title = body.title.trim();
    const text = body.body.trim();
    if (!name || !title || !text) {
      throw new BadRequestException({ code: "NAME_TITLE_AND_BODY_REQUIRED" });
    }
    if (body.kind === "trigger") {
      if (!body.trigger_type) {
        throw new BadRequestException({ code: "TRIGGER_TYPE_REQUIRED" });
      }
      // Some triggers are email-only on purpose. Enforced here rather than only
      // in the form, so the rule holds for anything hitting the API directly.
      if (!supportsInApp(body.trigger_type)) {
        throw new BadRequestException({ code: "TRIGGER_IS_EMAIL_ONLY" });
      }
    }

    const { data: inserted, error } = await this.supabase.client
      .from("notification_messages")
      .insert({
        kind: body.kind,
        name,
        title,
        body: text,
        url: body.url?.trim() || null,
        category: body.category ?? "activity",
        // A trigger reaches exactly the wallet that acted, so its audience is
        // always 'all'; the column matters only for announcements.
        audience:
          body.kind === "announcement" ? (body.audience ?? "all") : "all",
        trigger_type: body.kind === "trigger" ? body.trigger_type : null,
        trigger_params: body.trigger_params ?? {},
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
    body: UpdateNotificationMessageDto
  ): Promise<NotificationMessage> {
    const existing = await this.get(id);
    if (!existing) throw new NotFoundException({ code: "NOT_FOUND" });
    // Editing live copy would silently change what an active trigger says
    // without any record of the switch, so pause it first.
    if (existing.status === "active") {
      throw new BadRequestException({ code: "PAUSE_BEFORE_EDIT" });
    }

    const payload: Row = {};
    if (body.name !== undefined) {
      const v = body.name.trim();
      if (!v) throw new BadRequestException({ code: "INVALID_NAME" });
      payload.name = v;
    }
    if (body.title !== undefined) {
      const v = body.title.trim();
      if (!v) throw new BadRequestException({ code: "INVALID_TITLE" });
      payload.title = v;
    }
    if (body.body !== undefined) {
      const v = body.body.trim();
      if (!v) throw new BadRequestException({ code: "INVALID_BODY" });
      payload.body = v;
    }
    if (body.url !== undefined) payload.url = body.url?.trim() || null;
    if (body.category !== undefined) payload.category = body.category;
    if (body.audience !== undefined && existing.kind === "announcement") {
      payload.audience = body.audience;
    }
    if (body.trigger_type !== undefined && existing.kind === "trigger") {
      if (!supportsInApp(body.trigger_type)) {
        throw new BadRequestException({ code: "TRIGGER_IS_EMAIL_ONLY" });
      }
      payload.trigger_type = body.trigger_type;
    }
    if (body.trigger_params !== undefined) {
      payload.trigger_params = body.trigger_params;
    }

    if (Object.keys(payload).length) {
      const { error } = await this.supabase.client
        .from("notification_messages")
        .update(payload)
        .eq("id", id);
      if (error) {
        throw new BadRequestException({ code: "MESSAGE_UPDATE_FAILED" });
      }
    }

    return (await this.get(id))!;
  }

  async setStatus(
    id: string,
    status: NotificationMessageStatus
  ): Promise<NotificationMessage> {
    const existing = await this.get(id);
    if (!existing) throw new NotFoundException({ code: "NOT_FOUND" });
    if (existing.kind !== "trigger") {
      throw new BadRequestException({ code: "NOT_A_TRIGGER_MESSAGE" });
    }

    const { error } = await this.supabase.client
      .from("notification_messages")
      .update({ status })
      .eq("id", id);

    if (error) {
      // The partial unique index guarantees a single active message per
      // trigger, so this is the collision an admin most likely hit.
      if (error.code === UNIQUE_VIOLATION) {
        throw new BadRequestException({ code: "TRIGGER_ALREADY_ACTIVE" });
      }
      throw new BadRequestException({ code: "MESSAGE_STATUS_UPDATE_FAILED" });
    }

    return (await this.get(id))!;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from("notification_messages")
      .delete()
      .eq("id", id);
    if (error) {
      throw new BadRequestException({ code: "MESSAGE_DELETE_FAILED" });
    }
  }
}
