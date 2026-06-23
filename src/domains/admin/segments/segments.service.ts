import { Injectable } from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseService } from "@core/supabase/supabase.service";
import { AuditService } from "@domains/platform/audit/audit.service";
import { Recipient, SegmentId } from "./segments.types";

type Row = Record<string, unknown>;

const DEPOSIT_ACTIONS = new Set([
  "vaults_deposit",
  "lend_deposit",
  "pool_repay",
]);

@Injectable()
export class SegmentsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService
  ) {}

  private async paginateAuditLogsMinimal(): Promise<
    { wallet_address: string; action_type: string }[]
  > {
    const rows = await this.audit.query("wallet_address,action_type");
    const out: { wallet_address: string; action_type: string }[] = [];
    for (const r of rows) {
      const w =
        typeof r.wallet_address === "string" ? r.wallet_address.trim() : "";
      const at = typeof r.action_type === "string" ? r.action_type.trim() : "";
      if (w) out.push({ wallet_address: w, action_type: at });
    }
    return out;
  }

  private async paginateVerifiedUsers(
    client: SupabaseClient
  ): Promise<Recipient[]> {
    const pageSize = 1000;
    let offset = 0;
    const out: Recipient[] = [];
    for (;;) {
      const { data, error } = await client
        .from("users")
        .select("email,wallet_address,email_verified_at")
        .not("email", "is", null)
        .not("email_verified_at", "is", null)
        .order("wallet_address", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error || !data?.length) break;
      const rows = data as Row[];
      for (const r of rows) {
        const email =
          typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
        const wallet =
          typeof r.wallet_address === "string" ? r.wallet_address.trim() : "";
        if (!email || !wallet) continue;
        out.push({ email, wallet_address: wallet });
      }
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
    return out;
  }

  private filterRecipients(
    segment: SegmentId,
    verifiedUsers: Recipient[],
    depositorsSet: Set<string>,
    swappersSet: Set<string>,
    anyActivitySet: Set<string>
  ): Recipient[] {
    switch (segment) {
      case "all":
        return verifiedUsers;
      case "depositors":
        return verifiedUsers.filter((u) => depositorsSet.has(u.wallet_address));
      case "non_depositors":
        return verifiedUsers.filter(
          (u) => !depositorsSet.has(u.wallet_address)
        );
      case "swappers_only":
        return verifiedUsers.filter(
          (u) =>
            swappersSet.has(u.wallet_address) &&
            !depositorsSet.has(u.wallet_address)
        );
      case "inactive":
        return verifiedUsers.filter(
          (u) => !anyActivitySet.has(u.wallet_address)
        );
      default: {
        const _exhaustive: never = segment;
        return _exhaustive;
      }
    }
  }

  async getSegmentRecipients(segment: SegmentId): Promise<Recipient[]> {
    const client = this.supabase.client;

    const [verifiedUsers, audits] = await Promise.all([
      this.paginateVerifiedUsers(client),
      this.paginateAuditLogsMinimal(),
    ]);

    const depositorsSet = new Set<string>();
    const swappersSet = new Set<string>();
    const anyActivitySet = new Set<string>();

    for (const row of audits) {
      const w = row.wallet_address;
      if (!w) continue;
      anyActivitySet.add(w);
      if (row.action_type === "swap") swappersSet.add(w);
      if (DEPOSIT_ACTIONS.has(row.action_type)) depositorsSet.add(w);
    }

    return this.filterRecipients(
      segment,
      verifiedUsers,
      depositorsSet,
      swappersSet,
      anyActivitySet
    );
  }

  async getSegmentCount(segment: SegmentId): Promise<number> {
    const recipients = await this.getSegmentRecipients(segment);
    return recipients.length;
  }
}
