import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import { ErrorCode } from "@neko/api-contracts";
import { SupabaseService } from "@core/supabase/supabase.service";
import { NotificationsService } from "@domains/platform/notifications/notifications.service";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const CODE_CREATE_RETRIES = 3;

export interface ReferredBy {
  code: string;
}

export interface ReferralMe {
  code: string;
  referred_total: number;
  referred_confirmed: number;
  swap_volume_usd: number;
  vault_tvl_usd: number;
  referred_by: ReferredBy | null;
}

export interface ReferralLeaderboardRow {
  referrer_wallet: string;
  code: string;
  email: string | null;
  confirmed_count: number;
  swap_volume_usd: number;
  vault_tvl_usd: number;
}

export interface ReferralPartnerLeaderboardRow {
  partner_id: string;
  name: string;
  type: "company" | "influencer";
  code: string;
  confirmed_count: number;
  swap_volume_usd: number;
  vault_tvl_usd: number;
}

export interface ReferredBreakdownRow {
  referred_wallet: string;
  email: string | null;
  referred_at: string;
  swap_volume_usd: number;
  vault_tvl_usd: number;
}

type CodeOwner =
  | { kind: "wallet"; wallet: string }
  | { kind: "partner"; partnerId: string };

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService
  ) {}

  private generateCode(): string {
    const bytes = randomBytes(CODE_LENGTH);
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    return code;
  }

  async getOrCreateCode(wallet: string): Promise<{ code: string }> {
    const trimmed = wallet.trim();
    if (!trimmed) {
      throw new NotFoundException({ code: ErrorCode.WALLET_REQUIRED });
    }

    const { data: existing } = await this.supabase.client
      .from("referral_codes")
      .select("code")
      .eq("wallet_address", trimmed)
      .maybeSingle();
    if (existing?.code) return { code: existing.code };

    for (let attempt = 0; attempt < CODE_CREATE_RETRIES; attempt++) {
      const code = this.generateCode();
      const { error } = await this.supabase.client
        .from("referral_codes")
        .insert({ wallet_address: trimmed, code });

      if (!error) return { code };

      // FK violation: the user row doesn't exist yet (register is
      // fire-and-forget, so tolerate the race by surfacing a 404).
      if (error.code === "23503") {
        throw new NotFoundException({ code: ErrorCode.USER_NOT_FOUND });
      }
      // Unique violation: either the code collided (retry) or another
      // request created this wallet's code concurrently (re-read).
      if (error.code === "23505") {
        const { data: raced } = await this.supabase.client
          .from("referral_codes")
          .select("code")
          .eq("wallet_address", trimmed)
          .maybeSingle();
        if (raced?.code) return { code: raced.code };
        continue;
      }
      this.logger.error(`create referral code failed: ${error.message}`);
      break;
    }
    throw new InternalServerErrorException({
      code: ErrorCode.CODE_CREATE_FAILED,
    });
  }

  /**
   * Resolves who owns a code: a wallet (self-served, via referral_codes) or
   * a partner (admin-created, via referral_partners). Checks wallets first
   * since that's the far more common path. A revoked partner code is
   * deleted outright (see ReferralPartnersService.remove), so there's no
   * "inactive but still present" state to filter out here.
   */
  private async resolveCodeOwner(code: string): Promise<CodeOwner | null> {
    const { data: walletOwner } = await this.supabase.client
      .from("referral_codes")
      .select("wallet_address")
      .eq("code", code)
      .maybeSingle();
    if (walletOwner?.wallet_address) {
      return { kind: "wallet", wallet: walletOwner.wallet_address };
    }

    const { data: partnerOwner } = await this.supabase.client
      .from("referral_partners")
      .select("id")
      .eq("code", code)
      .maybeSingle();
    if (partnerOwner?.id) {
      return { kind: "partner", partnerId: partnerOwner.id };
    }

    return null;
  }

  private referralInsertRow(
    owner: CodeOwner,
    code: string,
    referredWallet: string
  ): Record<string, unknown> {
    // Confirmed immediately: referrals no longer wait on the referred
    // wallet verifying their email.
    const base = {
      code,
      referred_wallet: referredWallet,
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
    };
    return owner.kind === "wallet"
      ? { ...base, referrer_wallet: owner.wallet }
      : { ...base, referrer_partner_id: owner.partnerId };
  }

  /** Partner-owned referrals have no wallet to notify; wallet referrers get
   * told right away since confirmation is now immediate, not a later
   * async promotion. Best-effort: a failed notification must not roll back
   * a referral that already succeeded. */
  private async notifyReferrer(
    owner: CodeOwner,
    referralId: string
  ): Promise<void> {
    if (owner.kind !== "wallet") return;
    await this.notifications
      .emit({
        trigger: "referral_confirmed",
        walletAddress: owner.wallet,
        dedupeKey: `referral:${referralId}`,
      })
      .catch(() => undefined);
  }

  /**
   * Links a brand-new wallet to the referrer (wallet or partner) that owns
   * the given code. Never throws: registration must not fail because of a
   * bad ref code.
   */
  async attribute(params: {
    code: string;
    referred_wallet: string;
  }): Promise<void> {
    try {
      const code = params.code.trim().toUpperCase();
      const referred = params.referred_wallet.trim();
      if (!code || !referred) return;

      const owner = await this.resolveCodeOwner(code);
      if (!owner) return;
      if (owner.kind === "wallet" && owner.wallet === referred) return;

      const { data, error } = await this.supabase.client
        .from("referrals")
        .insert(this.referralInsertRow(owner, code, referred))
        .select("id")
        .single();
      if (error) {
        if (error.code !== "23505") {
          this.logger.warn(`referral attribution failed: ${error.message}`);
        }
        return;
      }
      await this.notifyReferrer(owner, data.id);
    } catch (err) {
      this.logger.warn(`referral attribution failed: ${String(err)}`);
    }
  }

  /**
   * Attaches a referral code to a wallet that's already registered but was
   * never attributed (e.g. it connected before the code was captured).
   * Unlike attribute(), this is a user-facing action: it throws on bad
   * input instead of silently no-op'ing.
   */
  async claim(wallet: string, rawCode: string): Promise<ReferredBy> {
    const trimmed = wallet.trim();
    const code = rawCode.trim().toUpperCase();
    if (!code) {
      throw new BadRequestException({ code: ErrorCode.INVALID_REFERRAL_CODE });
    }

    const { data: existing } = await this.supabase.client
      .from("referrals")
      .select("id")
      .eq("referred_wallet", trimmed)
      .maybeSingle();
    if (existing) {
      throw new BadRequestException({ code: ErrorCode.ALREADY_REFERRED });
    }

    const owner = await this.resolveCodeOwner(code);
    if (!owner) {
      throw new BadRequestException({ code: ErrorCode.INVALID_REFERRAL_CODE });
    }
    if (owner.kind === "wallet" && owner.wallet === trimmed) {
      throw new BadRequestException({
        code: ErrorCode.SELF_REFERRAL_NOT_ALLOWED,
      });
    }

    const { data, error } = await this.supabase.client
      .from("referrals")
      .insert(this.referralInsertRow(owner, code, trimmed))
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new BadRequestException({ code: ErrorCode.ALREADY_REFERRED });
      }
      if (error.code === "23503") {
        throw new NotFoundException({ code: ErrorCode.USER_NOT_FOUND });
      }
      this.logger.error(`claim insert failed: ${error.message}`);
      throw new InternalServerErrorException({
        code: ErrorCode.CLAIM_FAILED,
      });
    }
    await this.notifyReferrer(owner, data.id);

    return { code };
  }

  async getMe(wallet: string): Promise<ReferralMe> {
    const trimmed = wallet.trim();
    const { code } = await this.getOrCreateCode(trimmed);

    const [{ data, error }, referredByResult] = await Promise.all([
      this.supabase.client.rpc("referral_stats", { p_referrer: trimmed }),
      this.supabase.client
        .from("referrals")
        .select("code")
        .eq("referred_wallet", trimmed)
        .maybeSingle(),
    ]);
    if (error) {
      this.logger.error(`referral_stats failed: ${error.message}`);
      throw new InternalServerErrorException({ code: ErrorCode.STATS_FAILED });
    }

    const row = Array.isArray(data) ? data[0] : data;
    const referredByRow = referredByResult.data;
    return {
      code,
      referred_total: Number(row?.referred_total ?? 0),
      referred_confirmed: Number(row?.referred_confirmed ?? 0),
      swap_volume_usd: Number(row?.swap_volume_usd ?? 0),
      vault_tvl_usd: Number(row?.vault_tvl_usd ?? 0),
      referred_by: referredByRow ? { code: referredByRow.code } : null,
    };
  }

  /** Per-wallet breakdown of who a wallet referrer brought in, and how much
   * volume each one generated. Powers the leaderboard row's drill-down. */
  async getReferred(wallet: string): Promise<ReferredBreakdownRow[]> {
    const trimmed = wallet.trim();
    const { data, error } = await this.supabase.client.rpc(
      "referral_referred_breakdown",
      { p_referrer: trimmed }
    );
    if (error) {
      this.logger.error(`getReferred failed: ${error.message}`);
      throw new InternalServerErrorException({
        code: ErrorCode.REFERRED_FAILED,
      });
    }
    return this.mapBreakdownRows(data);
  }

  /** Same breakdown as getReferred, for a company/influencer partner. */
  async getPartnerReferred(partnerId: string): Promise<ReferredBreakdownRow[]> {
    const { data, error } = await this.supabase.client.rpc(
      "referral_partner_referred_breakdown",
      { p_partner_id: partnerId }
    );
    if (error) {
      this.logger.error(`getPartnerReferred failed: ${error.message}`);
      throw new InternalServerErrorException({
        code: ErrorCode.PARTNER_REFERRED_FAILED,
      });
    }
    return this.mapBreakdownRows(data);
  }

  private mapBreakdownRows(data: unknown): ReferredBreakdownRow[] {
    return (Array.isArray(data) ? data : []).map((row) => ({
      referred_wallet: row.referred_wallet,
      email: row.email ?? null,
      referred_at: row.referred_at,
      swap_volume_usd: Number(row.swap_volume_usd ?? 0),
      vault_tvl_usd: Number(row.vault_tvl_usd ?? 0),
    }));
  }

  async getLeaderboard(): Promise<ReferralLeaderboardRow[]> {
    const { data, error } = await this.supabase.client.rpc(
      "referral_leaderboard"
    );
    if (error) {
      this.logger.error(`referral_leaderboard failed: ${error.message}`);
      throw new InternalServerErrorException({
        code: ErrorCode.LEADERBOARD_FAILED,
      });
    }

    return (Array.isArray(data) ? data : []).map((row) => ({
      referrer_wallet: row.referrer_wallet,
      code: row.code,
      email: row.email ?? null,
      confirmed_count: Number(row.confirmed_count ?? 0),
      swap_volume_usd: Number(row.swap_volume_usd ?? 0),
      vault_tvl_usd: Number(row.vault_tvl_usd ?? 0),
    }));
  }

  /** Companies/influencers ranked by referred volume. Includes zero-referral
   * partners so admins see everyone onboarded, not just active ones. */
  async getPartnerLeaderboard(): Promise<ReferralPartnerLeaderboardRow[]> {
    const { data, error } = await this.supabase.client.rpc(
      "referral_partner_stats"
    );
    if (error) {
      this.logger.error(`referral_partner_stats failed: ${error.message}`);
      throw new InternalServerErrorException({
        code: ErrorCode.PARTNER_LEADERBOARD_FAILED,
      });
    }

    return (Array.isArray(data) ? data : []).map((row) => ({
      partner_id: row.partner_id,
      name: row.name,
      type: row.type,
      code: row.code,
      confirmed_count: Number(row.confirmed_count ?? 0),
      swap_volume_usd: Number(row.swap_volume_usd ?? 0),
      vault_tvl_usd: Number(row.vault_tvl_usd ?? 0),
    }));
  }
}
