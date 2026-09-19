import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SupabaseService } from "@core/supabase/supabase.service";
import { AuditService } from "@domains/platform/audit/audit.service";
import { MailingAudiencesService } from "../audiences/mailing-audiences.service";
import { AudienceId, isAudienceId } from "../audiences/mailing-audiences.types";
import { MAILING_SENDS_CONFLICT_TARGET } from "../mailing-sends.constants";
import { AdminWalletBalanceService } from "../triggers/admin-wallet-balance.service";
import { EnrollmentCandidate } from "./mailing-enrollment.types";

type Row = Record<string, unknown>;

const DEPOSIT_ACTIONS = new Set([
  "vaults_deposit",
  "lend_deposit",
  "pool_repay",
]);

const PAGE_SIZE = 1000;
const BATCH_CHUNK_SIZE = 500;

type DelayUnit = "minutes" | "hours" | "days";

type AutomationForResolve = {
  trigger_type: string;
  trigger_params: Record<string, unknown>;
  audience: string;
};

type ActiveAutomation = AutomationForResolve & {
  id: string;
  delay_value: number;
  delay_unit: DelayUnit;
};

@Injectable()
export class MailingEnrollmentService {
  private readonly logger = new Logger(MailingEnrollmentService.name);

  private readonly enrollmentFloorMs: number | null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
    private readonly audiences: MailingAudiencesService,
    private readonly adminWallet: AdminWalletBalanceService,
    private readonly config: ConfigService
  ) {
    const raw = this.config.get<string>("MAILING_ENROLLMENT_FLOOR")?.trim();
    if (!raw) {
      this.enrollmentFloorMs = null;
      return;
    }
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) {
      throw new Error(
        `MAILING_ENROLLMENT_FLOOR is not a valid ISO timestamp: ${raw}`
      );
    }
    this.enrollmentFloorMs = parsed;
    this.logger.log(`mailing enrollment floor set to ${raw}`);
  }

  /**
   * Alerts every active admin while the keeper wallet is under the threshold.
   *
   * trigger_at is bucketed to the UTC day so the send key
   * (message_id, email, trigger_at) collapses repeats within a day but lets a
   * fresh reminder through tomorrow if the balance still hasn't recovered.
   */
  private async resolveAdminWalletCandidates(
    thresholdXlm: number
  ): Promise<EnrollmentCandidate[]> {
    const balance = await this.adminWallet.getXlmBalance();
    if (balance === null) {
      this.logger.warn(
        "admin wallet balance unavailable; skipping low-balance enrollment"
      );
      return [];
    }
    if (balance >= thresholdXlm) return [];

    const admins = await this.audiences.getRecipients("admins");
    const today = new Date().toISOString().slice(0, 10);
    const trigger_at = `${today}T00:00:00.000Z`;

    this.logger.warn(
      `admin wallet balance ${balance} XLM is below ${thresholdXlm}; alerting ${admins.length} admin(s)`
    );

    return admins.map((a) => ({
      wallet_address: null,
      email: a.email,
      trigger_at,
    }));
  }

  private async loadVerifiedUsers(): Promise<Map<string, string>> {
    const client = this.supabase.client;
    let offset = 0;
    const out = new Map<string, string>();
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
        out.set(wallet, email);
      }
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return out;
  }

  private async resolveSignupCandidates(
    verifiedUsers: Map<string, string>
  ): Promise<EnrollmentCandidate[]> {
    const client = this.supabase.client;
    let offset = 0;
    const out: EnrollmentCandidate[] = [];
    for (;;) {
      const { data, error } = await client
        .from("users")
        .select("wallet_address,created_at")
        .order("wallet_address", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error || !data?.length) break;
      const rows = data as Row[];
      for (const r of rows) {
        const wallet =
          typeof r.wallet_address === "string" ? r.wallet_address.trim() : "";
        const createdAt = typeof r.created_at === "string" ? r.created_at : "";
        const email = wallet ? verifiedUsers.get(wallet) : undefined;
        if (!wallet || !email || !createdAt) continue;
        out.push({
          wallet_address: wallet,
          email,
          trigger_at: createdAt,
        });
      }
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return out;
  }

  private async resolveDepositCandidates(
    verifiedUsers: Map<string, string>
  ): Promise<EnrollmentCandidate[]> {
    const rows = await this.audit.query(
      "wallet_address,action_type,created_at",
      {
        whereIn: {
          column: "action_type",
          values: ["vaults_deposit", "lend_deposit", "pool_repay"],
        },
      }
    );

    const firstByWallet = new Map<string, string>();
    for (const r of rows) {
      const wallet =
        typeof r.wallet_address === "string" ? r.wallet_address.trim() : "";
      const action =
        typeof r.action_type === "string" ? r.action_type.trim() : "";
      const createdAt = typeof r.created_at === "string" ? r.created_at : "";
      if (!wallet || !createdAt || !DEPOSIT_ACTIONS.has(action)) continue;
      const prev = firstByWallet.get(wallet);
      if (!prev || createdAt < prev) firstByWallet.set(wallet, createdAt);
    }

    const out: EnrollmentCandidate[] = [];
    for (const [wallet, trigger_at] of firstByWallet) {
      const email = verifiedUsers.get(wallet);
      if (!email) continue;
      out.push({ wallet_address: wallet, email, trigger_at });
    }
    return out;
  }

  private async resolveSwapCandidates(
    verifiedUsers: Map<string, string>
  ): Promise<EnrollmentCandidate[]> {
    const rows = await this.audit.query(
      "wallet_address,action_type,created_at",
      {
        whereIn: { column: "action_type", values: ["swap"] },
      }
    );

    const firstByWallet = new Map<string, string>();
    for (const r of rows) {
      const wallet =
        typeof r.wallet_address === "string" ? r.wallet_address.trim() : "";
      const createdAt = typeof r.created_at === "string" ? r.created_at : "";
      if (!wallet || !createdAt) continue;
      const prev = firstByWallet.get(wallet);
      if (!prev || createdAt < prev) firstByWallet.set(wallet, createdAt);
    }

    const out: EnrollmentCandidate[] = [];
    for (const [wallet, trigger_at] of firstByWallet) {
      const email = verifiedUsers.get(wallet);
      if (!email) continue;
      out.push({ wallet_address: wallet, email, trigger_at });
    }
    return out;
  }

  private async resolveInactivityCandidates(
    verifiedUsers: Map<string, string>,
    inactivityDays: number
  ): Promise<EnrollmentCandidate[]> {
    const auditRows = await this.audit.query("wallet_address,created_at");
    const maxActivityByWallet = new Map<string, string>();
    for (const r of auditRows) {
      const wallet =
        typeof r.wallet_address === "string" ? r.wallet_address.trim() : "";
      const createdAt = typeof r.created_at === "string" ? r.created_at : "";
      if (!wallet || !createdAt) continue;
      const prev = maxActivityByWallet.get(wallet);
      if (!prev || createdAt > prev) maxActivityByWallet.set(wallet, createdAt);
    }

    const client = this.supabase.client;
    let offset = 0;
    const createdAtByWallet = new Map<string, string>();
    for (;;) {
      const { data, error } = await client
        .from("users")
        .select("wallet_address,created_at")
        .order("wallet_address", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error || !data?.length) break;
      const rows = data as Row[];
      for (const r of rows) {
        const wallet =
          typeof r.wallet_address === "string" ? r.wallet_address.trim() : "";
        const createdAt = typeof r.created_at === "string" ? r.created_at : "";
        if (!wallet || !createdAt || !verifiedUsers.has(wallet)) continue;
        createdAtByWallet.set(wallet, createdAt);
      }
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    const nowMs = Date.now();
    const out: EnrollmentCandidate[] = [];
    for (const [wallet, email] of verifiedUsers) {
      const lastActivity =
        maxActivityByWallet.get(wallet) ?? createdAtByWallet.get(wallet);
      if (!lastActivity) continue;
      const trigger_at = this.applyDelay(lastActivity, inactivityDays, "days");
      if (new Date(trigger_at).getTime() > nowMs) continue;
      out.push({ wallet_address: wallet, email, trigger_at });
    }
    return out;
  }

  private async resolveReferralCandidates(
    verifiedUsers: Map<string, string>
  ): Promise<EnrollmentCandidate[]> {
    const client = this.supabase.client;
    let offset = 0;
    const out: EnrollmentCandidate[] = [];
    for (;;) {
      const { data, error } = await client
        .from("referrals")
        .select("referred_wallet,confirmed_at")
        .eq("status", "confirmed")
        .not("confirmed_at", "is", null)
        .order("referred_wallet", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error || !data?.length) break;
      const rows = data as Row[];
      for (const r of rows) {
        const wallet =
          typeof r.referred_wallet === "string" ? r.referred_wallet.trim() : "";
        const confirmedAt =
          typeof r.confirmed_at === "string" ? r.confirmed_at : "";
        const email = wallet ? verifiedUsers.get(wallet) : undefined;
        if (!wallet || !email || !confirmedAt) continue;
        out.push({
          wallet_address: wallet,
          email,
          trigger_at: confirmedAt,
        });
      }
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return out;
  }

  private applyDelay(
    triggerAtIso: string,
    delayValue: number,
    delayUnit: DelayUnit
  ): string {
    const base = new Date(triggerAtIso).getTime();
    const msPerUnit =
      delayUnit === "minutes"
        ? 60_000
        : delayUnit === "hours"
          ? 3_600_000
          : 86_400_000;
    return new Date(base + delayValue * msPerUnit).toISOString();
  }

  async resolveCandidates(
    automation: AutomationForResolve
  ): Promise<EnrollmentCandidate[]> {
    let candidates: EnrollmentCandidate[];

    if (automation.trigger_type === "admin_wallet_low_balance") {
      const threshold = Number(automation.trigger_params?.threshold_xlm) || 50;
      // Recipients are resolved from admin_emails directly, so the audience
      // filter below would only ever narrow a list that's already correct.
      return this.resolveAdminWalletCandidates(threshold);
    }

    {
      const verifiedUsers = await this.loadVerifiedUsers();
      switch (automation.trigger_type) {
        case "signup":
          candidates = await this.resolveSignupCandidates(verifiedUsers);
          break;
        case "first_deposit":
          candidates = await this.resolveDepositCandidates(verifiedUsers);
          break;
        case "swap_completed":
          candidates = await this.resolveSwapCandidates(verifiedUsers);
          break;
        case "inactivity": {
          const inactivityDays =
            Number(automation.trigger_params?.inactivity_days) || 14;
          candidates = await this.resolveInactivityCandidates(
            verifiedUsers,
            inactivityDays
          );
          break;
        }
        case "referral_confirmed":
          candidates = await this.resolveReferralCandidates(verifiedUsers);
          break;
        default:
          candidates = [];
          break;
      }
    }

    if (automation.audience !== "all" && isAudienceId(automation.audience)) {
      const recipients = await this.audiences.getRecipients(
        automation.audience as AudienceId
      );
      // Wallet-less audiences (admins) are matched on email instead, so an
      // admin who is also a user still receives triggered mail.
      const allowedWallets = new Set(
        recipients
          .map((r) => r.wallet_address)
          .filter((w): w is string => w !== null)
      );
      const allowedEmails = new Set(
        recipients
          .filter((r) => r.wallet_address === null)
          .map((r) => r.email.toLowerCase())
      );
      candidates = candidates.filter(
        (c) =>
          (c.wallet_address !== null && allowedWallets.has(c.wallet_address)) ||
          allowedEmails.has(c.email.toLowerCase())
      );
    }

    if (this.enrollmentFloorMs !== null) {
      const floor = this.enrollmentFloorMs;
      candidates = candidates.filter((c) => {
        const at = Date.parse(c.trigger_at);
        return !Number.isNaN(at) && at >= floor;
      });
    }

    return candidates;
  }

  async previewCount(messageId: string): Promise<number> {
    const { data, error } = await this.supabase.client
      .from("mailing_messages")
      .select("trigger_type,trigger_params,audience")
      .eq("id", messageId)
      .maybeSingle();
    if (error || !data || typeof data !== "object") return 0;

    const row = data as Row;
    const trigger_params =
      typeof row.trigger_params === "object" &&
      row.trigger_params !== null &&
      !Array.isArray(row.trigger_params)
        ? (row.trigger_params as Record<string, unknown>)
        : {};

    const candidates = await this.resolveCandidates({
      trigger_type: String(row.trigger_type ?? ""),
      trigger_params,
      audience: typeof row.audience === "string" ? row.audience : "all",
    });
    return candidates.length;
  }

  async run(): Promise<{ automationsProcessed: number; enrolled: number }> {
    const { data, error } = await this.supabase.client
      .from("mailing_messages")
      .select(
        "id,trigger_type,trigger_params,delay_value,delay_unit,audience,status"
      )
      .eq("kind", "automation")
      .eq("status", "active");

    if (error || !data?.length) {
      return { automationsProcessed: 0, enrolled: 0 };
    }

    let automationsProcessed = 0;
    // "enrolled" = candidates attempted (exact new-row counts aren't cheaply
    // available with ignoreDuplicates upserts).
    let enrolled = 0;

    for (const raw of data as Row[]) {
      const id = typeof raw.id === "string" ? raw.id : null;
      if (!id) continue;

      const delayRaw = Number(raw.delay_value);
      const delay_value = Number.isFinite(delayRaw) ? delayRaw : 0;
      const delay_unit: DelayUnit =
        raw.delay_unit === "minutes" ||
        raw.delay_unit === "hours" ||
        raw.delay_unit === "days"
          ? raw.delay_unit
          : "days";
      const trigger_params =
        typeof raw.trigger_params === "object" &&
        raw.trigger_params !== null &&
        !Array.isArray(raw.trigger_params)
          ? (raw.trigger_params as Record<string, unknown>)
          : {};

      const automation: ActiveAutomation = {
        id,
        trigger_type: String(raw.trigger_type ?? ""),
        trigger_params,
        delay_value,
        delay_unit,
        audience: typeof raw.audience === "string" ? raw.audience : "all",
      };

      try {
        const candidates = await this.resolveCandidates(automation);
        const rows = candidates.map((c) => ({
          message_id: automation.id,
          wallet_address: c.wallet_address,
          email: c.email,
          trigger_at: c.trigger_at,
          scheduled_send_at: this.applyDelay(
            c.trigger_at,
            automation.delay_value,
            automation.delay_unit
          ),
          status: "pending",
        }));

        for (let i = 0; i < rows.length; i += BATCH_CHUNK_SIZE) {
          const chunk = rows.slice(i, i + BATCH_CHUNK_SIZE);
          const { error: upsertError } = await this.supabase.client
            .from("mailing_sends")
            .upsert(chunk, {
              onConflict: MAILING_SENDS_CONFLICT_TARGET,
              ignoreDuplicates: true,
            });
          if (upsertError) {
            throw new Error(upsertError.message);
          }
        }

        automationsProcessed += 1;
        enrolled += candidates.length;
      } catch (err) {
        this.logger.error(
          `mailing-enrollment failed for automation ${id}: ${(err as Error).message}`,
          (err as Error).stack
        );
      }
    }

    return { automationsProcessed, enrolled };
  }
}
