import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ErrorCode } from "@neko/api-contracts";
import { EmailService } from "@core/email/email.service";
import { SegmentsService } from "../segments/segments.service";
import { isSegmentId } from "../segments/segments.types";
import { SupabaseService } from "@core/supabase/supabase.service";
import { CreateCampaignDto } from "./dto/create-campaign.dto";
import { UpdateCampaignDto } from "./dto/update-campaign.dto";
import { Campaign, CampaignStatus } from "./campaigns.types";

const STATUS_ALLOWED: CampaignStatus[] = ["draft", "sending", "sent", "failed"];

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0 || at === email.length - 1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const first = local.slice(0, 1).toLowerCase();
  return `${first}***@${domain}`;
}

function htmlForRecipient(bodyHtml: string, walletAddress: string): string {
  return bodyHtml.replace(/\{\{\s*wallet_address\s*\}\}/g, walletAddress);
}

@Injectable()
export class CampaignsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly segments: SegmentsService,
    private readonly email: EmailService
  ) {}

  private mapRow(row: Record<string, unknown>): Campaign | null {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) return null;
    const status = row.status as CampaignStatus;
    const safeStatus = STATUS_ALLOWED.includes(status) ? status : "draft";

    const rc = row.recipient_count;
    const recipient_count = rc === null || rc === undefined ? null : Number(rc);

    return {
      id,
      name: String(row.name ?? ""),
      subject: String(row.subject ?? ""),
      body_html: String(row.body_html ?? ""),
      segment: typeof row.segment === "string" ? row.segment : "all",
      status: safeStatus,
      recipient_count:
        recipient_count !== null && Number.isFinite(recipient_count)
          ? recipient_count
          : null,
      sent_at: typeof row.sent_at === "string" ? row.sent_at : null,
      created_at: String(row.created_at ?? ""),
      created_by: row.created_by == null ? null : String(row.created_by),
      tvl_moved:
        row.tvl_moved !== null &&
        row.tvl_moved !== undefined &&
        Number.isFinite(Number(row.tvl_moved))
          ? Number(row.tvl_moved)
          : null,
    };
  }

  async getStats(): Promise<{
    total: number;
    sent: number;
    draft: number;
    tvl_moved_total: number;
  }> {
    const client = this.supabase.client;
    const [total, sent, draft, tvlRows] = await Promise.all([
      client.from("campaigns").select("*", { count: "exact", head: true }),
      client
        .from("campaigns")
        .select("*", { count: "exact", head: true })
        .eq("status", "sent"),
      client
        .from("campaigns")
        .select("*", { count: "exact", head: true })
        .eq("status", "draft"),
      client.from("campaigns").select("tvl_moved"),
    ]);

    const tvl_moved_total = (tvlRows.data ?? []).reduce((acc, r) => {
      const v = Number((r as Record<string, unknown>).tvl_moved);
      return acc + (Number.isFinite(v) ? v : 0);
    }, 0);

    return {
      total: total.count ?? 0,
      sent: sent.count ?? 0,
      draft: draft.count ?? 0,
      tvl_moved_total,
    };
  }

  async list(): Promise<Campaign[]> {
    const { data, error } = await this.supabase.client
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error || !data?.length) return [];

    const out: Campaign[] = [];
    for (const r of data as Record<string, unknown>[]) {
      const c = this.mapRow(r);
      if (c) out.push(c);
    }
    return out;
  }

  async get(id: string): Promise<Campaign | null> {
    const { data, error } = await this.supabase.client
      .from("campaigns")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data || typeof data !== "object") return null;
    return this.mapRow(data as Record<string, unknown>);
  }

  async create(body: CreateCampaignDto): Promise<Campaign> {
    const name = body.name.trim();
    const subject = body.subject.trim();
    if (!name || !subject) {
      throw new BadRequestException({
        code: ErrorCode.NAME_AND_SUBJECT_REQUIRED,
      });
    }
    const segmentRaw = typeof body.segment === "string" ? body.segment : "all";
    if (!isSegmentId(segmentRaw)) {
      throw new BadRequestException({ code: ErrorCode.INVALID_SEGMENT });
    }

    const { data: inserted, error } = await this.supabase.client
      .from("campaigns")
      .insert({
        name,
        subject,
        body_html: body.body_html,
        segment: segmentRaw,
        created_by: "admin",
        status: "draft",
      })
      .select("*")
      .maybeSingle();

    const campaign =
      !error && inserted
        ? this.mapRow(inserted as Record<string, unknown>)
        : null;
    if (!campaign) {
      throw new BadRequestException({
        code: ErrorCode.CAMPAIGN_CREATE_FAILED,
      });
    }
    return campaign;
  }

  async update(id: string, body: UpdateCampaignDto): Promise<Campaign> {
    const campaign = await this.get(id);
    if (!campaign) throw new NotFoundException({ code: ErrorCode.NOT_FOUND });
    if (campaign.status !== "draft") {
      throw new BadRequestException({
        code: ErrorCode.ONLY_DRAFT_EDITABLE,
      });
    }

    const payload: Record<string, string> = {};
    if (body.name !== undefined) {
      const v = body.name.trim();
      if (!v) throw new BadRequestException({ code: ErrorCode.INVALID_NAME });
      payload.name = v;
    }
    if (body.subject !== undefined) {
      const v = body.subject.trim();
      if (!v) {
        throw new BadRequestException({ code: ErrorCode.INVALID_SUBJECT });
      }
      payload.subject = v;
    }
    if (body.body_html !== undefined) payload.body_html = body.body_html;
    if (body.segment !== undefined) {
      if (!isSegmentId(body.segment)) {
        throw new BadRequestException({ code: ErrorCode.INVALID_SEGMENT });
      }
      payload.segment = body.segment;
    }

    if (Object.keys(payload).length) {
      const { error } = await this.supabase.client
        .from("campaigns")
        .update(payload)
        .eq("id", id);
      if (error) {
        throw new BadRequestException({
          code: ErrorCode.CAMPAIGN_UPDATE_FAILED,
        });
      }
    }

    const updated = await this.get(id);
    return updated!;
  }

  async updateTvl(
    id: string,
    tvlMovedRaw: number | string | null | undefined
  ): Promise<void> {
    const tvl_moved =
      tvlMovedRaw !== null &&
      tvlMovedRaw !== undefined &&
      Number.isFinite(Number(tvlMovedRaw))
        ? Number(tvlMovedRaw)
        : null;

    const { error } = await this.supabase.client
      .from("campaigns")
      .update({ tvl_moved })
      .eq("id", id);
    if (error) {
      throw new BadRequestException({ code: ErrorCode.TVL_UPDATE_FAILED });
    }
  }

  async preview(id: string): Promise<{ count: number; sample: string[] }> {
    const campaign = await this.get(id);
    if (!campaign) throw new NotFoundException({ code: ErrorCode.NOT_FOUND });

    const segmentId = isSegmentId(campaign.segment) ? campaign.segment : null;
    if (!segmentId) return { count: 0, sample: [] };

    const recipients = await this.segments.getSegmentRecipients(segmentId);
    const sample = recipients.slice(0, 5).map((r) => maskEmail(r.email));
    return { count: recipients.length, sample };
  }

  private async setStatus(
    id: string,
    status: CampaignStatus,
    recipientCount?: number,
    sentAt?: string
  ): Promise<void> {
    const update: Record<string, unknown> = { status };
    if (recipientCount !== undefined) update.recipient_count = recipientCount;
    if (sentAt !== undefined) update.sent_at = sentAt;
    await this.supabase.client.from("campaigns").update(update).eq("id", id);
  }

  async send(id: string): Promise<{ ok: true; sent: number }> {
    const campaign = await this.get(id);
    if (!campaign) throw new NotFoundException({ code: ErrorCode.NOT_FOUND });

    if (campaign.status === "sent") {
      throw new BadRequestException({ code: ErrorCode.ALREADY_SENT });
    }
    if (campaign.status === "sending") {
      throw new BadRequestException({ code: ErrorCode.SEND_IN_PROGRESS });
    }

    if (campaign.status === "failed") {
      await this.supabase.client
        .from("campaigns")
        .update({ status: "draft", recipient_count: null, sent_at: null })
        .eq("id", id);
    }

    if (!this.email.isConfigured) {
      throw new BadRequestException({
        code: ErrorCode.RESEND_NOT_CONFIGURED,
      });
    }

    const segmentId = isSegmentId(campaign.segment) ? campaign.segment : null;
    if (!segmentId) {
      throw new BadRequestException({ code: ErrorCode.INVALID_SEGMENT });
    }

    const recipients = await this.segments.getSegmentRecipients(segmentId);
    if (recipients.length === 0) {
      throw new BadRequestException({ code: ErrorCode.NO_RECIPIENTS });
    }

    await this.setStatus(id, "sending");

    try {
      await this.email.sendBatch(
        recipients.map((r) => ({
          to: r.email,
          subject: campaign.subject,
          html: htmlForRecipient(campaign.body_html, r.wallet_address),
        }))
      );
      await this.setStatus(
        id,
        "sent",
        recipients.length,
        new Date().toISOString()
      );
      return { ok: true, sent: recipients.length };
    } catch (e) {
      await this.setStatus(id, "failed");
      const message = e instanceof Error ? e.message : "Send failed";
      throw new BadRequestException({ code: ErrorCode.SEND_FAILED, message });
    }
  }
}
