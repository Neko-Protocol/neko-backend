import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SupabaseService } from "@core/supabase/supabase.service";
import { MailingAudiencesService } from "../audiences/mailing-audiences.service";
import { CreateMailingTemplateDto } from "./dto/create-mailing-template.dto";
import { UpdateMailingTemplateDto } from "./dto/update-mailing-template.dto";
import { MailingTemplate } from "./mailing-templates.types";

@Injectable()
export class MailingTemplatesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audiences: MailingAudiencesService
  ) {}

  private mapRow(row: Record<string, unknown>): MailingTemplate | null {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) return null;

    return {
      id,
      name: String(row.name ?? ""),
      subject: String(row.subject ?? ""),
      body_html: String(row.body_html ?? ""),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
      created_by: row.created_by == null ? null : String(row.created_by),
    };
  }

  async list(): Promise<MailingTemplate[]> {
    const { data, error } = await this.supabase.client
      .from("mailing_templates")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error || !data?.length) return [];

    const out: MailingTemplate[] = [];
    for (const r of data as Record<string, unknown>[]) {
      const t = this.mapRow(r);
      if (t) out.push(t);
    }
    return out;
  }

  async get(id: string): Promise<MailingTemplate | null> {
    const { data, error } = await this.supabase.client
      .from("mailing_templates")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data || typeof data !== "object") return null;
    return this.mapRow(data as Record<string, unknown>);
  }

  async create(body: CreateMailingTemplateDto): Promise<MailingTemplate> {
    const name = body.name.trim();
    const subject = body.subject.trim();
    if (!name || !subject) {
      throw new BadRequestException({ code: "NAME_AND_SUBJECT_REQUIRED" });
    }

    const { data: inserted, error } = await this.supabase.client
      .from("mailing_templates")
      .insert({
        name,
        subject,
        body_html: body.body_html,
        created_by: await this.audiences.resolveCreatedBy(body.created_by),
      })
      .select("*")
      .maybeSingle();

    const template =
      !error && inserted
        ? this.mapRow(inserted as Record<string, unknown>)
        : null;
    if (!template) {
      throw new BadRequestException({ code: "TEMPLATE_CREATE_FAILED" });
    }
    return template;
  }

  async update(
    id: string,
    body: UpdateMailingTemplateDto
  ): Promise<MailingTemplate> {
    const template = await this.get(id);
    if (!template) throw new NotFoundException({ code: "NOT_FOUND" });

    const payload: Record<string, string> = {};
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
    if (body.body_html !== undefined) payload.body_html = body.body_html;

    if (Object.keys(payload).length) {
      const { error } = await this.supabase.client
        .from("mailing_templates")
        .update(payload)
        .eq("id", id);
      if (error) {
        throw new BadRequestException({ code: "TEMPLATE_UPDATE_FAILED" });
      }
    }

    const updated = await this.get(id);
    return updated!;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from("mailing_templates")
      .delete()
      .eq("id", id);
    if (!error) return;
    if (error.code === "23503") {
      throw new BadRequestException({ code: "TEMPLATE_IN_USE" });
    }
    throw new BadRequestException({ code: "TEMPLATE_DELETE_FAILED" });
  }
}
