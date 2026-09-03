import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { SupabaseService } from "@core/supabase/supabase.service";

/** An expired admin_sessions row is already invalid the moment it expires
 * (isAdminSessionValid checks expires_at, not row existence) — this just
 * keeps the table from growing forever with rows nothing reads again. */
@Injectable()
export class AdminSessionsCleanupCron {
  private readonly logger = new Logger(AdminSessionsCleanupCron.name);

  constructor(private readonly supabase: SupabaseService) {}

  @Cron("0 * * * *", { name: "admin-sessions-cleanup-hourly" })
  async run(): Promise<void> {
    const { error, count } = await this.supabase.client
      .from("admin_sessions")
      .delete({ count: "exact" })
      .lt("expires_at", new Date().toISOString());

    if (error) {
      this.logger.error(`admin sessions cleanup failed: ${error.message}`);
      return;
    }
    this.logger.log(`admin sessions cleanup removed ${count ?? 0} row(s)`);
  }
}
