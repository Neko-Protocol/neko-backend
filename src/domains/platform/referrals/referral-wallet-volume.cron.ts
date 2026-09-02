import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { SupabaseService } from "@core/supabase/supabase.service";

/** Keeps referral_wallet_volume (a materialized view precomputing per-wallet
 * swap/vault volume) close to live without every stats/leaderboard/breakdown
 * read having to re-scan audit_logs. REFRESH ... CONCURRENTLY never blocks
 * reads while it runs. */
@Injectable()
export class ReferralWalletVolumeCron {
  private readonly logger = new Logger(ReferralWalletVolumeCron.name);

  constructor(private readonly supabase: SupabaseService) {}

  @Cron("*/10 * * * *", { name: "referral-wallet-volume-refresh" })
  async run(): Promise<void> {
    const { error } = await this.supabase.client.rpc(
      "refresh_referral_wallet_volume"
    );
    if (error) {
      this.logger.error(`refresh failed: ${error.message}`);
      return;
    }
    this.logger.log("referral wallet volume refreshed");
  }
}
