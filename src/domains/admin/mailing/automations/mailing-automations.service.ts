import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SupabaseService } from "@core/supabase/supabase.service";
import { isSegmentId } from "../../segments/segments.types";
import { isTriggerType } from "../mailing-triggers.types";
import { MailingTemplatesService } from "../templates/mailing-templates.service";
import { CreateMailingAutomationDto } from "./dto/create-mailing-automation.dto";
import { UpdateMailingAutomationDto } from "./dto/update-mailing-automation.dto";
import {
  MailingAutomation,
  MailingAutomationStatus,
} from "./mailing-automations.types";

const STATUS_ALLOWED: MailingAutomationStatus[] = [
  "draft",
  "active",
  "paused",
  "archived",
];

const DELAY_UNITS = ["minutes", "hours", "days"] as const;
type DelayUnit = (typeof DELAY_UNITS)[number];

const LEGAL_TRANSITIONS: Record<
  MailingAutomationStatus,
  MailingAutomationStatus[]
> = {
  draft: ["active", "archived"],
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  archived: [],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDelayUnit(value: unknown): value is DelayUnit {
  return (
    typeof value === "string" &&
    (DELAY_UNITS as readonly string[]).includes(value)
  );
}

export type MailingAutomationRun = {
  id: string;
  wallet_address: string;
  email: string;
  trigger_at: string;
  scheduled_send_at: string;
  status: string;
  sent_at: string | null;
  error: string | null;
};

@Injectable()
export class MailingAutomationsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly templates: MailingTemplatesService
  ) {}

  private mapRow(row: Record<string, unknown>): MailingAutomation | null {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) return null;

    const status = row.status as MailingAutomationStatus;
    const safeStatus = STATUS_ALLOWED.includes(status) ? status : "draft";

    const delayRaw = Number(row.delay_value);
    const delay_value = Number.isFinite(delayRaw) ? delayRaw : 0;

    const delay_unit: DelayUnit = isDelayUnit(row.delay_unit)
      ? row.delay_unit
      : "days";

    const trigger_params = isPlainObject(row.trigger_params)
      ? row.trigger_params
      : {};

    return {
      id,
      name: String(row.name ?? ""),
      trigger_type: String(row.trigger_type ?? ""),
      trigger_params,
      delay_value,
      delay_unit,
      segment: typeof row.segment === "string" ? row.segment : "all",
      template_id: typeof row.template_id === "string" ? row.template_id : null,
      status: safeStatus,
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
      created_by: row.created_by == null ? null : String(row.created_by),
    };
  }

  private mapRunRow(row: Record<string, unknown>): MailingAutomationRun | null {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) return null;

    return {
      id,
      wallet_address: String(row.wallet_address ?? ""),
      email: String(row.email ?? ""),
      trigger_at: String(row.trigger_at ?? ""),
      scheduled_send_at: String(row.scheduled_send_at ?? ""),
      status: String(row.status ?? ""),
      sent_at: typeof row.sent_at === "string" ? row.sent_at : null,
      error: row.error == null ? null : String(row.error),
    };
  }

  async list(): Promise<MailingAutomation[]> {
    const { data, error } = await this.supabase.client
      .from("mailing_automations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error || !data?.length) return [];

    const out: MailingAutomation[] = [];
    for (const r of data as Record<string, unknown>[]) {
      const a = this.mapRow(r);
      if (a) out.push(a);
    }
    return out;
  }

  async get(id: string): Promise<MailingAutomation | null> {
    const { data, error } = await this.supabase.client
      .from("mailing_automations")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data || typeof data !== "object") return null;
    return this.mapRow(data as Record<string, unknown>);
  }

  async create(body: CreateMailingAutomationDto): Promise<MailingAutomation> {
    const name = body.name.trim();
    if (!name) {
      throw new BadRequestException({ code: "NAME_REQUIRED" });
    }

    if (!isTriggerType(body.trigger_type)) {
      throw new BadRequestException({ code: "INVALID_TRIGGER_TYPE" });
    }

    const segment = typeof body.segment === "string" ? body.segment : "all";
    if (!isSegmentId(segment)) {
      throw new BadRequestException({ code: "INVALID_SEGMENT" });
    }

    let delay_unit: DelayUnit = "days";
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

    const template = await this.templates.get(body.template_id);
    if (!template) {
      throw new BadRequestException({ code: "INVALID_TEMPLATE" });
    }

    const trigger_params = isPlainObject(body.trigger_params)
      ? body.trigger_params
      : {};

    const { data: inserted, error } = await this.supabase.client
      .from("mailing_automations")
      .insert({
        name,
        trigger_type: body.trigger_type,
        trigger_params,
        delay_value,
        delay_unit,
        segment,
        template_id: body.template_id,
        created_by: "admin",
        status: "draft",
      })
      .select("*")
      .maybeSingle();

    const automation =
      !error && inserted
        ? this.mapRow(inserted as Record<string, unknown>)
        : null;
    if (!automation) {
      throw new BadRequestException({ code: "AUTOMATION_CREATE_FAILED" });
    }
    return automation;
  }

  async update(
    id: string,
    body: UpdateMailingAutomationDto
  ): Promise<MailingAutomation> {
    const automation = await this.get(id);
    if (!automation) throw new NotFoundException({ code: "NOT_FOUND" });
    if (automation.status !== "draft" && automation.status !== "paused") {
      throw new BadRequestException({ code: "ONLY_DRAFT_OR_PAUSED_EDITABLE" });
    }

    const payload: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const v = body.name.trim();
      if (!v) throw new BadRequestException({ code: "NAME_REQUIRED" });
      payload.name = v;
    }

    if (body.trigger_type !== undefined) {
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

    if (body.segment !== undefined) {
      if (!isSegmentId(body.segment)) {
        throw new BadRequestException({ code: "INVALID_SEGMENT" });
      }
      payload.segment = body.segment;
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

    if (body.template_id !== undefined) {
      const template = await this.templates.get(body.template_id);
      if (!template) {
        throw new BadRequestException({ code: "INVALID_TEMPLATE" });
      }
      payload.template_id = body.template_id;
    }

    if (Object.keys(payload).length) {
      const { error } = await this.supabase.client
        .from("mailing_automations")
        .update(payload)
        .eq("id", id);
      if (error) {
        throw new BadRequestException({ code: "AUTOMATION_UPDATE_FAILED" });
      }
    }

    const updated = await this.get(id);
    return updated!;
  }

  async setStatus(
    id: string,
    status: MailingAutomationStatus
  ): Promise<MailingAutomation> {
    const automation = await this.get(id);
    if (!automation) throw new NotFoundException({ code: "NOT_FOUND" });

    const allowed = LEGAL_TRANSITIONS[automation.status] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException({ code: "INVALID_STATUS_TRANSITION" });
    }

    const { error } = await this.supabase.client
      .from("mailing_automations")
      .update({ status })
      .eq("id", id);
    if (error) {
      throw new BadRequestException({ code: "AUTOMATION_UPDATE_FAILED" });
    }

    const updated = await this.get(id);
    return updated!;
  }

  async remove(id: string): Promise<void> {
    const automation = await this.get(id);
    if (!automation) throw new NotFoundException({ code: "NOT_FOUND" });
    if (automation.status !== "draft") {
      throw new BadRequestException({ code: "ONLY_DRAFT_DELETABLE" });
    }

    const { error } = await this.supabase.client
      .from("mailing_automations")
      .delete()
      .eq("id", id);
    if (error) {
      throw new BadRequestException({ code: "AUTOMATION_DELETE_FAILED" });
    }
  }

  async listRuns(
    id: string,
    opts?: { limit?: number }
  ): Promise<MailingAutomationRun[]> {
    const limit = opts?.limit ?? 100;
    const { data, error } = await this.supabase.client
      .from("mailing_automation_runs")
      .select("*")
      .eq("automation_id", id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data?.length) return [];

    const out: MailingAutomationRun[] = [];
    for (const r of data as Record<string, unknown>[]) {
      const run = this.mapRunRow(r);
      if (run) out.push(run);
    }
    return out;
  }

  async getRunStats(id: string): Promise<{
    enrolled: number;
    pending: number;
    sent: number;
    skipped: number;
    failed: number;
  }> {
    const client = this.supabase.client;
    const [enrolled, pending, sent, skipped, failed] = await Promise.all([
      client
        .from("mailing_automation_runs")
        .select("*", { count: "exact", head: true })
        .eq("automation_id", id),
      client
        .from("mailing_automation_runs")
        .select("*", { count: "exact", head: true })
        .eq("automation_id", id)
        .eq("status", "pending"),
      client
        .from("mailing_automation_runs")
        .select("*", { count: "exact", head: true })
        .eq("automation_id", id)
        .eq("status", "sent"),
      client
        .from("mailing_automation_runs")
        .select("*", { count: "exact", head: true })
        .eq("automation_id", id)
        .eq("status", "skipped"),
      client
        .from("mailing_automation_runs")
        .select("*", { count: "exact", head: true })
        .eq("automation_id", id)
        .eq("status", "failed"),
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
