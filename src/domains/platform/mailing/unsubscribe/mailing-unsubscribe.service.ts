import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { SupabaseService } from "@core/supabase/supabase.service";

@Injectable()
export class MailingUnsubscribeService {
  private readonly logger = new Logger(MailingUnsubscribeService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async recordOptOut(walletAddress: string): Promise<void> {
    let email: string | null = null;
    try {
      const { data, error } = await this.supabase.client
        .from("users")
        .select("email")
        .eq("wallet_address", walletAddress)
        .maybeSingle();
      if (error) {
        this.logger.warn(
          `mailing opt-out email lookup failed: ${error.message}`
        );
      } else {
        email = (data?.email as string | null | undefined) ?? null;
      }
    } catch (err) {
      this.logger.warn(`mailing opt-out email lookup failed: ${String(err)}`);
    }

    const { error: upsertError } = await this.supabase.client
      .from("mailing_opt_outs")
      .upsert(
        {
          wallet_address: walletAddress,
          email,
          opted_out_at: new Date().toISOString(),
        },
        { onConflict: "wallet_address" }
      );

    if (upsertError) {
      this.logger.warn(`mailing opt-out upsert failed: ${upsertError.message}`);
      throw new BadRequestException({ code: "OPT_OUT_FAILED" });
    }
  }
}
