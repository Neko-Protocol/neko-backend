import { Injectable, Logger } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";
import { SupabaseService } from "../supabase/supabase.service";

interface AdminUser {
  id: string;
  email: string;
  password_hash: string;
  totp_secret: string;
  is_active: boolean;
}

const TOTP_ISSUER = "Neko Admin";

const PASSWORD_HASH_COMMAND =
  "node -e \"const b=require('bcryptjs'); b.hash('YOUR_PASSWORD',10).then(console.log)\"";

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(private readonly supabase: SupabaseService) {}

  private async findAdminUser(email: string): Promise<AdminUser | null> {
    const { data } = await this.supabase.client
      .from("admin_users")
      .select("id, email, password_hash, totp_secret, is_active")
      .eq("email", email.toLowerCase().trim())
      .eq("is_active", true)
      .single();
    return (data as AdminUser | null) ?? null;
  }

  private buildTotp(email: string | undefined, base32Secret: string): TOTP {
    return new TOTP({
      issuer: TOTP_ISSUER,
      label: email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(base32Secret),
    });
  }

  async verifyPassword(
    email: string,
    password: string
  ): Promise<{ ok: boolean; email?: string }> {
    const user = await this.findAdminUser(email.trim());
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return { ok: false };
    }
    return { ok: true, email: user.email };
  }

  /** Step 2 — TOTP code for an already password-verified email. */
  async verifyTotp(email: string, code: string): Promise<{ ok: boolean }> {
    const user = await this.findAdminUser(email.trim());
    if (!user) return { ok: false };
    try {
      const totp = this.buildTotp(undefined, user.totp_secret);
      return { ok: totp.validate({ token: code.trim(), window: 1 }) !== null };
    } catch {
      return { ok: false };
    }
  }

  /** Provisioning helper — generate a fresh TOTP secret + QR for an email. */
  async getTotpSetup(email: string): Promise<{
    qrDataUrl: string;
    secret: string;
    uri: string;
    passwordHashCommand: string;
  }> {
    const secret = new Secret().base32;
    const uri = this.buildTotp(email, secret).toString();
    const qrDataUrl = await QRCode.toDataURL(uri);
    return {
      qrDataUrl,
      secret,
      uri,
      passwordHashCommand: PASSWORD_HASH_COMMAND,
    };
  }

  async listAdminEmails(): Promise<{ emails: string[] }> {
    const { data, error } = await this.supabase.client
      .from("admin_users")
      .select("email")
      .eq("is_active", true)
      .order("email", { ascending: true });

    if (error || !data?.length) {
      if (error) this.logger.error(`listAdminEmails failed: ${error.message}`);
      return { emails: [] };
    }

    const emails = (data as { email?: string }[])
      .map((r) => String(r.email ?? ""))
      .filter((e) => e.length > 0);
    return { emails };
  }
}
