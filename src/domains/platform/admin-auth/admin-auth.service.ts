import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomInt } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SupabaseService } from "@core/supabase/supabase.service";
import { EmailService } from "@core/email/email.service";

export interface RequestCodeResult {
  ok: boolean;
  reason?: "not_authorized" | "send_failed";
}

export interface VerifyCodeResult {
  ok: boolean;
  tokenHash?: string;
  reason?: "invalid_code";
}

const CODE_TTL_MINUTES = 10;

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly authClient?: SupabaseClient;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly email: EmailService,
    private readonly config: ConfigService
  ) {
    const url = this.config.get<string>("SUPABASE_URL");
    const anonKey = this.config.get<string>("SUPABASE_ANON_KEY");
    if (url && anonKey) {
      this.authClient = createClient(url, anonKey, {
        auth: { persistSession: false },
      });
    }
  }

  /**
   * Verifies a Supabase access token belongs to a signed-in, currently
   * active admin. Used by AdminAuthGuard to protect admin-only routes.
   * Returns the admin's email, or null.
   */
  async verifyAdminToken(accessToken: string): Promise<string | null> {
    if (!this.authClient) return null;

    const { data, error } = await this.authClient.auth.getUser(accessToken);
    if (error || !data?.user?.email) return null;

    const email = data.user.email.trim().toLowerCase();
    const { data: allowed } = await this.supabase.client
      .from("admin_emails")
      .select("email")
      .eq("email", email)
      .eq("is_active", true)
      .maybeSingle();

    return allowed ? email : null;
  }

  private hashCode(code: string): string {
    return createHash("sha256").update(code).digest("hex");
  }

  async requestCode(rawEmail: string): Promise<RequestCodeResult> {
    const email = rawEmail.trim().toLowerCase();

    const { data: allowed } = await this.supabase.client
      .from("admin_emails")
      .select("email")
      .eq("email", email)
      .eq("is_active", true)
      .maybeSingle();

    if (!allowed) return { ok: false, reason: "not_authorized" };

    await this.supabase.client
      .from("admin_login_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("email", email)
      .is("consumed_at", null);

    const code = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);

    const { error: insertError } = await this.supabase.client
      .from("admin_login_codes")
      .insert({
        email,
        code_hash: this.hashCode(code),
        expires_at: expiresAt.toISOString(),
      });

    if (insertError) {
      this.logger.warn(
        `[admin-auth] failed to store code: ${insertError.message}`
      );
      return { ok: false, reason: "send_failed" };
    }

    try {
      await this.email.send({
        to: email,
        subject: `${code} is your Neko Admin sign-in code`,
        html: this.buildCodeEmailHtml(code),
        text: this.buildCodeEmailText(code),
      });
    } catch (err) {
      this.logger.warn(`[admin-auth] email send failed: ${String(err)}`);
      return { ok: false, reason: "send_failed" };
    }

    return { ok: true };
  }

  async verifyCode(
    rawEmail: string,
    rawCode: string
  ): Promise<VerifyCodeResult> {
    const email = rawEmail.trim().toLowerCase();
    const codeHash = this.hashCode(rawCode.trim());

    const { data: match } = await this.supabase.client
      .from("admin_login_codes")
      .select("id")
      .eq("email", email)
      .eq("code_hash", codeHash)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!match) return { ok: false, reason: "invalid_code" };

    await this.supabase.client
      .from("admin_login_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", match.id);

    const { data, error } = await this.supabase.client.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

    if (error || !data?.properties?.hashed_token) {
      this.logger.warn(`[admin-auth] generateLink failed: ${error?.message}`);
      return { ok: false, reason: "invalid_code" };
    }

    return { ok: true, tokenHash: data.properties.hashed_token };
  }

  private buildCodeEmailHtml(code: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Neko Admin sign-in code</title>
</head>
<body style="margin:0;padding:0;background:#121212;">
  <div style="background:#121212;padding:32px;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
    <div style="max-width:420px;margin:0 auto;background:#1a1a1a;border:1px solid #334eac55;border-radius:16px;padding:32px;">
      <h1 style="margin:0 0 8px;font-size:20px;">Neko Admin</h1>
      <p style="margin:0 0 24px;color:#bad6eb;font-size:14px;">
        Someone requested to sign in to the Neko Admin console with this email address. Use the code below to continue. It expires in ${CODE_TTL_MINUTES} minutes.
      </p>
      <div style="background:#0f0f0f;border-radius:12px;padding:16px;text-align:center;font-size:28px;font-weight:700;letter-spacing:8px;color:#68f9f2;">
        ${code}
      </div>
      <p style="margin:24px 0 0;color:#7096d1;font-size:12px;">
        If you didn't request this, you can safely ignore this email, no action is needed and your account is safe.
      </p>
      <p style="margin:16px 0 0;color:#556;font-size:11px;">
        Neko Protocol &middot; nekoprotocol.xyz
      </p>
    </div>
  </div>
</body>
</html>`;
  }

  private buildCodeEmailText(code: string): string {
    return [
      "Neko Admin sign-in code",
      "",
      `Someone requested to sign in to the Neko Admin console with this email address. Use this code to continue: ${code}`,
      "",
      `This code expires in ${CODE_TTL_MINUTES} minutes.`,
      "",
      "If you didn't request this, you can safely ignore this email.",
    ].join("\n");
  }
}
