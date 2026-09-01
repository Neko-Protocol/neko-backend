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
  status: "pending" | "confirmed";
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

export interface ReferredUser {
  referred_wallet: string;
  status: string;
  confirmed_at: string | null;
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
   * a partner (admin-created, via referral_partners — only if still active).
   * Checks wallets first since that's the far more common path.
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
      .select("id, is_active")
      .eq("code", code)
      .maybeSingle();
    if (partnerOwner?.id && partnerOwner.is_active) {
      return { kind: "partner", partnerId: partnerOwner.id };
    }

    return null;
  }

  private referralInsertRow(
    owner: CodeOwner,
    code: string,
    referredWallet: string
  ): Record<string, unknown> {
    return owner.kind === "wallet"
      ? { code, referrer_wallet: owner.wallet, referred_wallet: referredWallet }
      : {
          code,
          referrer_partner_id: owner.partnerId,
          referred_wallet: referredWallet,
        };
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

      const { error } = await this.supabase.client
        .from("referrals")
        .insert(this.referralInsertRow(owner, code, referred));
      if (error && error.code !== "23505") {
        this.logger.warn(`referral attribution failed: ${error.message}`);
      }
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

    const { error } = await this.supabase.client
      .from("referrals")
      .insert(this.referralInsertRow(owner, code, trimmed));
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

    return { code, status: "pending" };
  }

  /**
   * Promotes pending referrals whose referred user has verified their email.
   *
   * Public because email verification is the causal event: UsersService calls
   * this the moment a wallet's address is confirmed, rather than leaving
   * confirmation to whenever someone happens to load the referral page.
   */
  async confirmPending(referrerWallet?: string): Promise<void> {
    let query = this.supabase.client
      .from("referrals")
      .select("id, referrer_wallet, referred_wallet")
      .eq("status", "pending");
    if (referrerWallet) query = query.eq("referrer_wallet", referrerWallet);

    const { data: pending, error } = await query;
    if (error) {
      this.logger.error(`confirmPending select failed: ${error.message}`);
      return;
    }
    if (!pending?.length) return;

    const { data: verified, error: usersError } = await this.supabase.client
      .from("users")
      .select("wallet_address")
      .in(
        "wallet_address",
        pending.map((row) => row.referred_wallet)
      )
      .not("email_verified_at", "is", null);
    if (usersError) {
      this.logger.error(`confirmPending users failed: ${usersError.message}`);
      return;
    }

    const verifiedWallets = new Set(
      (verified ?? []).map((row) => row.wallet_address)
    );
    const confirmable = pending
      .filter((row) => verifiedWallets.has(row.referred_wallet))
      .map((row) => row.id);
    if (!confirmable.length) return;

    // Returning the affected rows is what makes notifying safe: the
    // `.eq("status", "pending")` guard means a concurrent caller can only flip
    // each row once, so whoever gets it back is the one that flipped it.
    const { data: confirmed, error: updateError } = await this.supabase.client
      .from("referrals")
      .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
      .in("id", confirmable)
      .eq("status", "pending")
      .select("id, referrer_wallet");
    if (updateError) {
      this.logger.error(`confirmPending update failed: ${updateError.message}`);
      return;
    }

    // The referrer is the one who earns something here, so they are the one
    // who gets told.
    for (const row of confirmed ?? []) {
      const referrer =
        typeof row.referrer_wallet === "string" ? row.referrer_wallet : "";
      if (!referrer) continue;
      await this.notifications.emit({
        trigger: "referral_confirmed",
        walletAddress: referrer,
        dedupeKey: `referral:${row.id}`,
      });
    }
  }

  async getMe(wallet: string): Promise<ReferralMe> {
    const trimmed = wallet.trim();
    await this.confirmPending(trimmed);
    const { code } = await this.getOrCreateCode(trimmed);

    const [{ data, error }, referredByResult] = await Promise.all([
      this.supabase.client.rpc("referral_stats", { p_referrer: trimmed }),
      this.supabase.client
        .from("referrals")
        .select("code, status")
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
      referred_by: referredByRow
        ? {
            code: referredByRow.code,
            status: referredByRow.status as "pending" | "confirmed",
          }
        : null,
    };
  }

  async getReferred(wallet: string): Promise<ReferredUser[]> {
    const trimmed = wallet.trim();
    const { data, error } = await this.supabase.client
      .from("referrals")
      .select("referred_wallet, status, confirmed_at")
      .eq("referrer_wallet", trimmed)
      .order("confirmed_at", { ascending: false });

    if (error) {
      this.logger.error(`getReferred failed: ${error.message}`);
      throw new InternalServerErrorException({
        code: ErrorCode.REFERRED_FAILED,
      });
    }

    return (data ?? []).map((row) => ({
      referred_wallet: row.referred_wallet,
      status: row.status,
      confirmed_at: row.confirmed_at ?? null,
    }));
  }

  async getLeaderboard(): Promise<ReferralLeaderboardRow[]> {
    await this.confirmPending();

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
    await this.confirmPending();

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
