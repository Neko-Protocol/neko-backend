import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { UserPreferences, UserPublic } from "@neko/api-contracts";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { ReferralsService } from "../referrals/referrals.service";
import { SupabaseService } from "../supabase/supabase.service";
import { EmailConfirmDto } from "./dto/email-confirm.dto";
import { EmailStartDto } from "./dto/email-start.dto";
import { RegisterUserDto } from "./dto/register-user.dto";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly authClient?: SupabaseClient;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly referrals: ReferralsService
  ) {
    const url = this.config.get<string>("SUPABASE_URL");
    const anonKey = this.config.get<string>("SUPABASE_ANON_KEY");
    if (url && anonKey) {
      this.authClient = createClient(url, anonKey, {
        auth: { persistSession: false },
      });
    }
  }

  private dbNetwork(): string {
    const envNet =
      this.config.get<string>("STELLAR_NETWORK")?.trim().toUpperCase() ?? "";
    if (envNet === "MAINNET" || envNet === "PUBLIC") return "mainnet";
    return "testnet";
  }

  private get webAppBaseUrl(): string | undefined {
    const raw = this.config.get<string>("WEB_APP_URL");
    if (!raw) return undefined;
    return raw.replace(/\/$/, "");
  }

  async register(dto: RegisterUserDto): Promise<{ ok: true }> {
    try {
      const wallet = dto.wallet_address?.trim();
      if (!wallet) return { ok: true };

      const provider = dto.wallet_provider?.trim() || null;

      const { error: insertError } = await this.supabase.client
        .from("users")
        .insert({
          wallet_address: wallet,
          wallet_provider: provider,
          network: this.dbNetwork(),
        });

      if (insertError) {
        const isDuplicate =
          insertError.code === "23505" ||
          /duplicate key/i.test(insertError.message ?? "");
        if (!isDuplicate) return { ok: true };

        if (provider) {
          await this.supabase.client
            .from("users")
            .update({ wallet_provider: provider })
            .eq("wallet_address", wallet)
            .is("wallet_provider", null);
        } else {
          await this.supabase.client
            .from("users")
            .update({ updated_at: new Date().toISOString() })
            .eq("wallet_address", wallet);
        }

        return { ok: true };
      }

      // Referral attribution only on the first-ever insert, so an existing
      // user reconnecting with someone's ref code can never be claimed.
      if (dto.ref_code?.trim()) {
        await this.referrals.attribute({
          code: dto.ref_code,
          referred_wallet: wallet,
        });
      }

      return { ok: true };
    } catch (err) {
      this.logger.error("register unexpected error", err);
      return { ok: true };
    }
  }

  async get(wallet: string): Promise<UserPublic | null> {
    try {
      const trimmed = wallet.trim();
      if (!trimmed) return null;

      const { data, error } = await this.supabase.client
        .from("users")
        .select(
          "wallet_address, wallet_provider, email, email_verified_at, created_at, preferences"
        )
        .eq("wallet_address", trimmed)
        .maybeSingle();

      if (error || !data) return null;

      const user: UserPublic = {
        wallet_address: data.wallet_address,
        wallet_provider: data.wallet_provider ?? null,
        email: data.email ?? null,
        email_verified_at: data.email_verified_at ?? null,
        created_at: data.created_at,
        preferences: (data.preferences as UserPreferences) ?? {},
      };
      return user;
    } catch (err) {
      this.logger.error("get unexpected error", err);
      return null;
    }
  }

  async updatePreferences(dto: UpdatePreferencesDto): Promise<{ ok: true }> {
    try {
      const wallet = dto.wallet_address?.trim();
      const incoming = dto.preferences;
      if (!wallet || !incoming) return { ok: true };

      const { data } = await this.supabase.client
        .from("users")
        .select("preferences")
        .eq("wallet_address", wallet)
        .maybeSingle();

      const current = (data?.preferences as Record<string, unknown>) ?? {};
      const merged = { ...current, ...incoming };

      await this.supabase.client
        .from("users")
        .update({ preferences: merged })
        .eq("wallet_address", wallet);

      return { ok: true };
    } catch (err) {
      this.logger.error("updatePreferences unexpected error", err);
      return { ok: true };
    }
  }

  async startEmailVerification(dto: EmailStartDto): Promise<{ ok: true }> {
    const wallet = dto.wallet_address?.trim();
    const email = dto.email?.trim().toLowerCase();

    if (!wallet) {
      throw new BadRequestException({ code: "wallet_required" });
    }
    if (!email || !EMAIL_RE.test(email)) {
      throw new BadRequestException({ code: "invalid_email" });
    }

    if (!this.authClient) {
      throw new InternalServerErrorException({ code: "not_configured" });
    }

    const baseUrl = this.webAppBaseUrl;
    if (!baseUrl) {
      throw new InternalServerErrorException({ code: "not_configured" });
    }

    const { error: upsertError } = await this.supabase.client
      .from("users")
      .upsert(
        {
          wallet_address: wallet,
          network: this.dbNetwork(),
          email,
          email_verified_at: null,
        },
        { onConflict: "wallet_address" }
      );

    if (upsertError) {
      throw new InternalServerErrorException({
        code: "db_error",
        message: upsertError.message ?? "db_error",
      });
    }

    const redirectTo = `${baseUrl}/auth/email-confirmed?wallet=${encodeURIComponent(wallet)}`;
    const { error } = await this.authClient.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: redirectTo,
        data: { wallet_address: wallet },
      },
    });

    if (error) {
      throw new InternalServerErrorException({
        code: "send_failed",
        message: error.message ?? "send_failed",
      });
    }

    return { ok: true };
  }

  /**
   * Browser-navigated magic-link handler. Supabase email templates that send a
   * `token_hash` directly point here; we verify server-side (no cookies) and the
   * controller 302-redirects to the web-app /settings page.
   */
  async confirmEmailByTokenHash(
    wallet: string | undefined,
    tokenHash: string | undefined,
    type: string | undefined
  ): Promise<boolean> {
    try {
      if (!wallet || !tokenHash) return false;
      if (!this.authClient) return false;

      const { data, error } = await this.authClient.auth.verifyOtp({
        type: (type as "magiclink" | "email") ?? "magiclink",
        token_hash: tokenHash,
      });
      if (error || !data?.user?.email) return false;

      const { error: updateError } = await this.supabase.client
        .from("users")
        .update({
          email: data.user.email,
          email_verified_at: new Date().toISOString(),
          auth_user_id: data.user.id,
        })
        .eq("wallet_address", wallet);

      return !updateError;
    } catch (err) {
      this.logger.warn(
        `confirmEmailByTokenHash failed: ${(err as Error).message}`
      );
      return false;
    }
  }

  /** Absolute URL of the web-app settings page used as the magic-link redirect. */
  settingsRedirectUrl(status: "verified" | "error"): string {
    const base = this.webAppBaseUrl ?? "";
    return `${base}/settings?email=${status}`;
  }

  async confirmEmail(dto: EmailConfirmDto): Promise<{ ok: true }> {
    const wallet = dto.wallet?.trim();
    const accessToken = dto.access_token?.trim();
    if (!wallet || !accessToken) {
      throw new BadRequestException({ code: "missing_params" });
    }

    if (!this.authClient) {
      throw new InternalServerErrorException({ code: "not_configured" });
    }

    const { data, error } = await this.authClient.auth.getUser(accessToken);
    if (error || !data?.user?.email) {
      throw new UnauthorizedException({ code: "invalid_token" });
    }

    const { error: updateError } = await this.supabase.client
      .from("users")
      .update({
        email: data.user.email,
        email_verified_at: new Date().toISOString(),
        auth_user_id: data.user.id,
      })
      .eq("wallet_address", wallet);

    if (updateError) {
      throw new InternalServerErrorException({ code: "update_failed" });
    }

    return { ok: true };
  }
}
