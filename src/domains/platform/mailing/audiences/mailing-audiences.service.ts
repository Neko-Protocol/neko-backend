import { Injectable } from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseService } from "@core/supabase/supabase.service";
import { AuditService } from "@domains/platform/audit/audit.service";
import { AudienceId, Recipient } from "./mailing-audiences.types";

type Row = Record<string, unknown>;

const PAGE_SIZE = 1000;

/** Any deposit-shaped action, used by the broad `depositors` audience. */
const DEPOSIT_ACTIONS = new Set([
  "vaults_deposit",
  "lend_deposit",
  "pool_repay",
]);

/** Vault deposits specifically, used by `vault_depositors`. */
const VAULT_DEPOSIT_ACTION = "vaults_deposit";

@Injectable()
export class MailingAudiencesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService
  ) {}

  private async loadVerifiedUsers(
    client: SupabaseClient
  ): Promise<Recipient[]> {
    let offset = 0;
    const out: Recipient[] = [];
    for (;;) {
      const { data, error } = await client
        .from("users")
        .select("email,wallet_address,email_verified_at")
        .not("email", "is", null)
        .not("email_verified_at", "is", null)
        .order("wallet_address", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
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
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return out;
  }

  /**
   * Admin recipients come from `admin_emails` (the legacy `admin_users` table
   * was dropped in admin migration 0002), so they carry no wallet address.
   */
  private async loadAdmins(client: SupabaseClient): Promise<Recipient[]> {
    const { data, error } = await client
      .from("admin_emails")
      .select("email,is_active")
      .eq("is_active", true)
      .order("email", { ascending: true });
    if (error || !data?.length) return [];

    const out: Recipient[] = [];
    for (const r of data as Row[]) {
      const email =
        typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
      if (!email) continue;
      out.push({ email, wallet_address: null });
    }
    return out;
  }

  private async loadActivitySets(): Promise<{
    depositors: Set<string>;
    vaultDepositors: Set<string>;
    swappers: Set<string>;
    anyActivity: Set<string>;
  }> {
    const rows = await this.audit.query("wallet_address,action_type");

    const depositors = new Set<string>();
    const vaultDepositors = new Set<string>();
    const swappers = new Set<string>();
    const anyActivity = new Set<string>();

    for (const r of rows) {
      const wallet =
        typeof r.wallet_address === "string" ? r.wallet_address.trim() : "";
      const action =
        typeof r.action_type === "string" ? r.action_type.trim() : "";
      if (!wallet) continue;
      anyActivity.add(wallet);
      if (action === "swap") swappers.add(wallet);
      if (action === VAULT_DEPOSIT_ACTION) vaultDepositors.add(wallet);
      if (DEPOSIT_ACTIONS.has(action)) depositors.add(wallet);
    }

    return { depositors, vaultDepositors, swappers, anyActivity };
  }

  async getRecipients(audience: AudienceId): Promise<Recipient[]> {
    const client = this.supabase.client;

    if (audience === "admins") {
      return this.loadAdmins(client);
    }

    const verified = await this.loadVerifiedUsers(client);
    if (audience === "all") return verified;

    const sets = await this.loadActivitySets();
    const has = (s: Set<string>, r: Recipient) =>
      r.wallet_address !== null && s.has(r.wallet_address);

    switch (audience) {
      case "vault_depositors":
        return verified.filter((r) => has(sets.vaultDepositors, r));
      case "depositors":
        return verified.filter((r) => has(sets.depositors, r));
      case "non_depositors":
        return verified.filter((r) => !has(sets.depositors, r));
      case "swappers_only":
        return verified.filter(
          (r) => has(sets.swappers, r) && !has(sets.depositors, r)
        );
      case "inactive":
        return verified.filter((r) => !has(sets.anyActivity, r));
      default: {
        const _exhaustive: never = audience;
        return _exhaustive;
      }
    }
  }

  async getCount(audience: AudienceId): Promise<number> {
    const recipients = await this.getRecipients(audience);
    return recipients.length;
  }

  /**
   * Recipients minus anyone who has opted out. Broadcasts and automations must
   * both honour this — an opt-out is a standing instruction, not a per-send
   * preference. Admin-list recipients have no wallet and so are never filtered.
   */
  async getSendableRecipients(audience: AudienceId): Promise<Recipient[]> {
    const recipients = await this.getRecipients(audience);
    const wallets = recipients
      .map((r) => r.wallet_address)
      .filter((w): w is string => typeof w === "string" && w.length > 0);
    if (!wallets.length) return recipients;

    const optedOut = new Set<string>();
    for (let i = 0; i < wallets.length; i += PAGE_SIZE) {
      const chunk = wallets.slice(i, i + PAGE_SIZE);
      const { data, error } = await this.supabase.client
        .from("mailing_opt_outs")
        .select("wallet_address")
        .in("wallet_address", chunk);
      if (error) continue;
      for (const r of (data ?? []) as Row[]) {
        if (typeof r.wallet_address === "string")
          optedOut.add(r.wallet_address);
      }
    }

    return recipients.filter(
      (r) => r.wallet_address === null || !optedOut.has(r.wallet_address)
    );
  }
}
