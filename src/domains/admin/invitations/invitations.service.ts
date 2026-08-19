import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ErrorCode } from "@neko/api-contracts";
import { EmailService } from "@core/email/email.service";
import { SupabaseService } from "@core/supabase/supabase.service";
import { CreateInvitationDto } from "./dto/create-invitation.dto";
import {
  INVITATION_TYPES,
  Invitation,
  InvitationFilters,
  InvitationStatus,
  InvitationType,
} from "./invitations.types";

const STATUS_SET = new Set<InvitationStatus>([
  "pending",
  "accepted",
  "expired",
]);
const TYPE_SET = new Set<string>(INVITATION_TYPES.map((t) => t.id));

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

interface ParsedInvitation {
  email: string;
  type: InvitationType;
  assigned_to: string | null;
  notes: string | null;
  expires_days: number;
  strategy_id: string | null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function typeLabel(type: string): string {
  return INVITATION_TYPES.find((x) => x.id === type)?.label ?? type;
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly email: EmailService,
    private readonly config: ConfigService
  ) {}

  private mapRow(row: Record<string, unknown>): Invitation | null {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) return null;

    let typeRaw = typeof row.type === "string" ? row.type : "user";
    if (!TYPE_SET.has(typeRaw)) typeRaw = "user";
    const type = typeRaw as InvitationType;

    const statusRaw = typeof row.status === "string" ? row.status : "pending";
    const status: InvitationStatus = STATUS_SET.has(
      statusRaw as InvitationStatus
    )
      ? (statusRaw as InvitationStatus)
      : "pending";

    const strategyIdRaw = row.strategy_id;
    const strategy_id =
      strategyIdRaw === null || strategyIdRaw === undefined
        ? null
        : typeof strategyIdRaw === "string"
          ? strategyIdRaw
          : String(strategyIdRaw);

    return {
      id,
      email: String(row.email ?? ""),
      type,
      token: String(row.token ?? ""),
      status,
      assigned_to:
        row.assigned_to === null || row.assigned_to === undefined
          ? null
          : String(row.assigned_to),
      notes:
        row.notes === null || row.notes === undefined
          ? null
          : String(row.notes),
      created_by:
        row.created_by === null || row.created_by === undefined
          ? null
          : String(row.created_by),
      strategy_id,
      accepted_at: typeof row.accepted_at === "string" ? row.accepted_at : null,
      accepted_notes:
        row.accepted_notes === null || row.accepted_notes === undefined
          ? null
          : String(row.accepted_notes),
      volume_moved:
        row.volume_moved !== null &&
        row.volume_moved !== undefined &&
        Number.isFinite(Number(row.volume_moved))
          ? Number(row.volume_moved)
          : null,
      expires_at: String(row.expires_at ?? ""),
      created_at: String(row.created_at ?? ""),
    };
  }

  private parseBody(body: CreateInvitationDto): ParsedInvitation {
    const emailRaw =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!emailRaw || !EMAIL_RE.test(emailRaw)) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_EMAIL,
        message: "Valid email address is required",
      });
    }

    const typeRaw = typeof body.type === "string" ? body.type.trim() : "user";
    const type: InvitationType = TYPE_SET.has(typeRaw)
      ? (typeRaw as InvitationType)
      : "user";

    const assignedRaw =
      typeof body.assigned_to === "string" ? body.assigned_to.trim() : "";
    const assigned_to = assignedRaw.length > 0 ? assignedRaw : null;

    const notes =
      typeof body.notes === "string" ? body.notes.trim() || null : null;

    let expires_days = Number(body.expires_days);
    if (!Number.isFinite(expires_days) || ![7, 14, 30].includes(expires_days)) {
      expires_days = 7;
    }

    const sidRaw =
      typeof body.strategy_id === "string" ? body.strategy_id.trim() : "";
    const strategy_id = sidRaw.length > 0 ? sidRaw : null;

    return {
      email: emailRaw,
      type,
      assigned_to,
      notes,
      expires_days,
      strategy_id,
    };
  }

  async list(filters: InvitationFilters = {}): Promise<Invitation[]> {
    let q = this.supabase.client
      .from("invitations")
      .select("*")
      .order("created_at", { ascending: false });

    if (filters.strategy_id && filters.strategy_id.length > 0) {
      q = q.eq("strategy_id", filters.strategy_id);
    }
    if (filters.status && STATUS_SET.has(filters.status as InvitationStatus)) {
      q = q.eq("status", filters.status);
    }
    if (filters.type && TYPE_SET.has(filters.type)) {
      q = q.eq("type", filters.type);
    }
    if (filters.assigned_to && filters.assigned_to.length > 0) {
      q = q.eq("assigned_to", filters.assigned_to);
    }

    const { data, error } = await q.limit(500);
    if (error || !data?.length) return [];

    const out: Invitation[] = [];
    for (const r of data as Record<string, unknown>[]) {
      const inv = this.mapRow(r);
      if (inv) out.push(inv);
    }
    return out;
  }

  async create(
    body: CreateInvitationDto,
    overrides: { strategy_id?: string | null } = {}
  ): Promise<Invitation> {
    const parsed = this.parseBody(body);
    const strategyId =
      overrides.strategy_id !== undefined
        ? overrides.strategy_id
        : parsed.strategy_id;

    const expiresAt = new Date(
      Date.now() + Math.max(1, Math.floor(parsed.expires_days)) * 86_400_000
    ).toISOString();

    const strat = strategyId?.trim()?.length ? strategyId.trim() : null;

    const { data: inserted, error } = await this.supabase.client
      .from("invitations")
      .insert({
        email: parsed.email,
        type: parsed.type,
        assigned_to: parsed.assigned_to,
        notes: parsed.notes,
        created_by: "admin",
        expires_at: expiresAt,
        strategy_id: strat,
      })
      .select("*")
      .maybeSingle();

    const invitation =
      !error && inserted
        ? this.mapRow(inserted as Record<string, unknown>)
        : null;
    if (!invitation) {
      throw new BadRequestException({
        code: ErrorCode.INVITATION_CREATE_FAILED,
      });
    }

    await this.sendInviteEmail(invitation);
    return invitation;
  }

  async accept(
    id: string,
    body: { accepted_notes?: string; volume_moved?: number | string | null }
  ): Promise<Invitation> {
    const accepted_notes =
      typeof body.accepted_notes === "string"
        ? body.accepted_notes.trim() || null
        : null;
    const volume_moved =
      body.volume_moved !== null &&
      body.volume_moved !== undefined &&
      Number.isFinite(Number(body.volume_moved))
        ? Number(body.volume_moved)
        : null;

    const { data: updated, error } = await this.supabase.client
      .from("invitations")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_notes,
        volume_moved,
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();

    const invitation =
      !error && updated
        ? this.mapRow(updated as Record<string, unknown>)
        : null;
    if (!invitation) {
      throw new BadRequestException({
        code: ErrorCode.INVITATION_ACCEPT_FAILED,
      });
    }
    return invitation;
  }

  async delete(id: string): Promise<void> {
    await this.supabase.client.from("invitations").delete().eq("id", id);
  }

  async markExpired(): Promise<void> {
    const now = new Date().toISOString();
    await this.supabase.client
      .from("invitations")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("expires_at", now);
  }

  private inviteEmailHtml(invitation: Invitation): string {
    const base =
      this.config.get<string>("WEB_APP_URL") || "https://dapp.nekoprotocol.xyz";
    const inviteUrl = `${base.replace(/\/+$/, "")}/invite?token=${encodeURIComponent(invitation.token)}`;
    const expiresAt = new Date(invitation.expires_at).toLocaleString(
      undefined,
      {
        dateStyle: "medium",
        timeStyle: "short",
      }
    );
    const lbl = escapeHtml(typeLabel(invitation.type));
    const expiresSafe = escapeHtml(expiresAt);
    return `
<div style="background:#121212;color:white;font-family:system-ui;padding:40px;border-radius:12px;max-width:480px">
  <h1 style="color:#229EDF;margin:0 0 16px">You're invited to Neko Protocol</h1>
  <p style="color:rgba(255,255,255,0.7)">You've been invited as a <strong style="color:white">${lbl}</strong>.</p>
  <p style="color:rgba(255,255,255,0.7)">Click below to get started:</p>
  <a href="${inviteUrl}" style="display:inline-block;background:#229EDF;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">Accept invitation</a>
  <p style="color:rgba(255,255,255,0.4);font-size:12px">This invitation expires on ${expiresSafe}. If you didn't expect this, ignore this email.</p>
</div>`.trim();
  }

  private async sendInviteEmail(invitation: Invitation): Promise<void> {
    await this.email.send({
      to: invitation.email,
      subject: "You're invited to Neko Protocol",
      html: this.inviteEmailHtml(invitation),
    });
  }
}
