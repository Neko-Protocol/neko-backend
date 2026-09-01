import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ErrorCode, type ReferralPartner } from "@neko/api-contracts";
import { SupabaseService } from "@core/supabase/supabase.service";
import { CreateReferralPartnerDto } from "./dto/create-referral-partner.dto";

type Row = Record<string, unknown>;

@Injectable()
export class ReferralPartnersService {
  constructor(private readonly supabase: SupabaseService) {}

  private mapRow(row: Row): ReferralPartner | null {
    const id = typeof row.id === "string" ? row.id : null;
    const name = typeof row.name === "string" ? row.name : null;
    const type =
      row.type === "company" || row.type === "influencer" ? row.type : null;
    const code = typeof row.code === "string" ? row.code : null;
    if (!id || !name || !type || !code) return null;

    return {
      id,
      name,
      type,
      code,
      email: row.email == null ? null : String(row.email),
      notes: row.notes == null ? null : String(row.notes),
      is_active: row.is_active !== false,
      created_by: row.created_by == null ? null : String(row.created_by),
      created_at: String(row.created_at ?? ""),
    };
  }

  async list(): Promise<ReferralPartner[]> {
    const { data, error } = await this.supabase.client
      .from("referral_partners")
      .select("*")
      .order("created_at", { ascending: false });
    if (error || !data?.length) return [];

    const out: ReferralPartner[] = [];
    for (const r of data as Row[]) {
      const row = this.mapRow(r);
      if (row) out.push(row);
    }
    return out;
  }

  /** A code is a single shared namespace: no partner code may collide with a
   * self-served wallet referral code, or vice versa. */
  private async codeIsTaken(code: string): Promise<boolean> {
    const [partner, wallet] = await Promise.all([
      this.supabase.client
        .from("referral_partners")
        .select("id")
        .eq("code", code)
        .maybeSingle(),
      this.supabase.client
        .from("referral_codes")
        .select("code")
        .eq("code", code)
        .maybeSingle(),
    ]);
    return Boolean(partner.data || wallet.data);
  }

  async create(dto: CreateReferralPartnerDto): Promise<ReferralPartner> {
    const name = dto.name.trim();
    const code = dto.code.trim().toUpperCase();
    if (!name)
      throw new BadRequestException({ code: ErrorCode.PARTNER_NAME_REQUIRED });
    if (!code)
      throw new BadRequestException({ code: ErrorCode.PARTNER_CODE_REQUIRED });

    if (await this.codeIsTaken(code)) {
      throw new BadRequestException({ code: ErrorCode.PARTNER_CODE_TAKEN });
    }

    const { data: inserted, error } = await this.supabase.client
      .from("referral_partners")
      .insert({
        name,
        type: dto.type,
        code,
        email: dto.email?.trim().toLowerCase() || null,
        notes: dto.notes?.trim() || null,
        created_by: dto.created_by?.trim().toLowerCase() || null,
      })
      .select("*")
      .maybeSingle();

    if (error?.code === "23505") {
      throw new BadRequestException({ code: ErrorCode.PARTNER_CODE_TAKEN });
    }
    const row = !error && inserted ? this.mapRow(inserted as Row) : null;
    if (!row)
      throw new BadRequestException({ code: ErrorCode.PARTNER_CREATE_FAILED });
    return row;
  }

  async setActive(id: string, isActive: boolean): Promise<ReferralPartner> {
    const { error } = await this.supabase.client
      .from("referral_partners")
      .update({ is_active: isActive })
      .eq("id", id);
    if (error) {
      throw new BadRequestException({ code: ErrorCode.PARTNER_UPDATE_FAILED });
    }

    const { data } = await this.supabase.client
      .from("referral_partners")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    const row = data ? this.mapRow(data as Row) : null;
    if (!row)
      throw new NotFoundException({ code: ErrorCode.PARTNER_NOT_FOUND });
    return row;
  }
}
