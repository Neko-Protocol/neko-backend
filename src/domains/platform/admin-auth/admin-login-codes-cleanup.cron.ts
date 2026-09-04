import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { SupabaseService } from "@core/supabase/supabase.service";

/** admin_login_codes has no automatic cleanup — an expired OTP code is
 * already useless the moment it expires (AdminAuthService checks
 * expires_at, not row existence), so like admin_sessions this just keeps
 * the table from growing forever with rows nothing reads again. */
@Injectable()
export class AdminLoginCodesCleanupCron {
  private readonly logger = new Logger(AdminLoginCodesCleanupCron.name);

  constructor(private readonly supabase: SupabaseService) {}

  @Cron("30 * * * *", { name: "admin-login-codes-cleanup-hourly" })
  async run(): Promise<void> {
    const { error, count } = await this.supabase.client
      .from("admin_login_codes")
      .delete({ count: "exact" })
      .lt("expires_at", new Date().toISOString());

    if (error) {
      this.logger.error(`admin login codes cleanup failed: ${error.message}`);
      return;
    }
    this.logger.log(`admin login codes cleanup removed ${count ?? 0} row(s)`);
  }
}
