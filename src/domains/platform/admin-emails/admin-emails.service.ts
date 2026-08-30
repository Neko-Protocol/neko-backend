import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SupabaseService } from "@core/supabase/supabase.service";
import { AdminEmail } from "./admin-emails.types";

type Row = Record<string, unknown>;

@Injectable()
export class AdminEmailsService {
  constructor(private readonly supabase: SupabaseService) {}

  private mapRow(row: Row): AdminEmail | null {
    const email = typeof row.email === "string" ? row.email : null;
    if (!email) return null;
    return {
      email,
      is_active: row.is_active !== false,
      added_by: row.added_by == null ? null : String(row.added_by),
      created_at: String(row.created_at ?? ""),
    };
  }

  async list(): Promise<AdminEmail[]> {
    const { data, error } = await this.supabase.client
      .from("admin_emails")
      .select("*")
      .order("created_at", { ascending: true });
    if (error || !data?.length) return [];

    const out: AdminEmail[] = [];
    for (const r of data as Row[]) {
      const row = this.mapRow(r);
      if (row) out.push(row);
    }
    return out;
  }

  async add(email: string, addedBy?: string): Promise<AdminEmail> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) throw new BadRequestException({ code: "EMAIL_REQUIRED" });

    const { data: existing } = await this.supabase.client
      .from("admin_emails")
      .select("email")
      .eq("email", normalized)
      .maybeSingle();
    if (existing) {
      throw new BadRequestException({ code: "ADMIN_ALREADY_EXISTS" });
    }

    const { data: inserted, error } = await this.supabase.client
      .from("admin_emails")
      .insert({
        email: normalized,
        is_active: true,
        added_by: addedBy?.trim().toLowerCase() ?? null,
      })
      .select("*")
      .maybeSingle();

    const row = !error && inserted ? this.mapRow(inserted as Row) : null;
    if (!row) throw new BadRequestException({ code: "ADMIN_CREATE_FAILED" });
    return row;
  }

  /**
   * Deactivates rather than deletes: mailing rows reference admin_emails for
   * created_by attribution, and revoking access shouldn't erase authorship.
   */
  async setActive(email: string, isActive: boolean): Promise<AdminEmail> {
    const normalized = email.trim().toLowerCase();

    if (!isActive) {
      const { count } = await this.supabase.client
        .from("admin_emails")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);
      // Locking every admin out of the admin app is not a recoverable action
      // from inside the admin app.
      if ((count ?? 0) <= 1) {
        throw new BadRequestException({ code: "LAST_ACTIVE_ADMIN" });
      }
    }

    const { error } = await this.supabase.client
      .from("admin_emails")
      .update({ is_active: isActive })
      .eq("email", normalized);
    if (error) throw new BadRequestException({ code: "ADMIN_UPDATE_FAILED" });

    const { data } = await this.supabase.client
      .from("admin_emails")
      .select("*")
      .eq("email", normalized)
      .maybeSingle();
    const row = data ? this.mapRow(data as Row) : null;
    if (!row) throw new NotFoundException({ code: "NOT_FOUND" });
    return row;
  }
}
