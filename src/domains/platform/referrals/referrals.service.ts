import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import { SupabaseService } from "@core/supabase/supabase.service";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const CODE_CREATE_RETRIES = 3;

export interface ReferralMe {
  code: string;
  referred_total: number;
  referred_confirmed: number;
  swap_volume_usd: number;
  vault_tvl_usd: number;
}

export interface ReferralLeaderboardRow {
  referrer_wallet: string;
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

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(private readonly supabase: SupabaseService) {}

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
      throw new NotFoundException({ code: "WALLET_REQUIRED" });
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
        throw new NotFoundException({ code: "USER_NOT_FOUND" });
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
    throw new InternalServerErrorException({ code: "CODE_CREATE_FAILED" });
  }

  /**
   * Links a brand-new wallet to the referrer that owns the given code.
   * Never throws: registration must not fail because of a bad ref code.
   */
  async attribute(params: {
    code: string;
    referred_wallet: string;
  }): Promise<void> {
    try {
      const code = params.code.trim().toUpperCase();
      const referred = params.referred_wallet.trim();
      if (!code || !referred) return;

      const { data: owner } = await this.supabase.client
        .from("referral_codes")
        .select("wallet_address")
        .eq("code", code)
        .maybeSingle();
      if (!owner?.wallet_address || owner.wallet_address === referred) return;

      const { error } = await this.supabase.client.from("referrals").insert({
        code,
        referrer_wallet: owner.wallet_address,
        referred_wallet: referred,
      });
      if (error && error.code !== "23505") {
        this.logger.warn(`referral attribution failed: ${error.message}`);
      }
    } catch (err) {
      this.logger.warn(`referral attribution failed: ${String(err)}`);
    }
  }

  /** Promotes pending referrals whose referred user has verified their email. */
  private async confirmPending(referrerWallet?: string): Promise<void> {
    let query = this.supabase.client
      .from("referrals")
      .select("id, referred_wallet")
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

    const { error: updateError } = await this.supabase.client
      .from("referrals")
      .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
      .in("id", confirmable)
      .eq("status", "pending");
    if (updateError) {
      this.logger.error(`confirmPending update failed: ${updateError.message}`);
    }
  }

  async getMe(wallet: string): Promise<ReferralMe> {
    const trimmed = wallet.trim();
    await this.confirmPending(trimmed);
    const { code } = await this.getOrCreateCode(trimmed);

    const { data, error } = await this.supabase.client.rpc("referral_stats", {
      p_referrer: trimmed,
    });
    if (error) {
      this.logger.error(`referral_stats failed: ${error.message}`);
      throw new InternalServerErrorException({ code: "STATS_FAILED" });
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      code,
      referred_total: Number(row?.referred_total ?? 0),
      referred_confirmed: Number(row?.referred_confirmed ?? 0),
      swap_volume_usd: Number(row?.swap_volume_usd ?? 0),
      vault_tvl_usd: Number(row?.vault_tvl_usd ?? 0),
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
      throw new InternalServerErrorException({ code: "REFERRED_FAILED" });
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
      throw new InternalServerErrorException({ code: "LEADERBOARD_FAILED" });
    }

    return (Array.isArray(data) ? data : []).map((row) => ({
      referrer_wallet: row.referrer_wallet,
      code: row.code,
      confirmed_count: Number(row.confirmed_count ?? 0),
      swap_volume_usd: Number(row.swap_volume_usd ?? 0),
      vault_tvl_usd: Number(row.vault_tvl_usd ?? 0),
    }));
  }
}
