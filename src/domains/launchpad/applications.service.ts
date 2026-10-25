import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ErrorCode } from "@neko-protocol/api-contracts";
import { SupabaseService } from "@core/supabase/supabase.service";
import { AccountsService } from "./accounts.service";
import { AssistantService } from "./assistant/assistant.service";
import type { CreateApplicationDto } from "./dto/create-application.dto";
import type { DecideApplicationDto } from "./dto/decide-application.dto";
import {
  LaunchpadErrorCode,
  toApplicationView,
  toVerificationView,
  type AccountRow,
  type AdminApplicationView,
  type ApplicationRow,
  type ApplicationStatus,
  type ApplicationView,
  type VerificationRow,
  type WalletRow,
} from "./launchpad.types";

const REVIEWABLE: ReadonlySet<ApplicationStatus> = new Set([
  "submitted",
  "in_review",
  "changes_requested",
]);

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly accounts: AccountsService,
    private readonly assistant: AssistantService
  ) {}

  async create(
    accessToken: string,
    dto: CreateApplicationDto
  ): Promise<ApplicationView> {
    const account = await this.accounts.getByAccessToken(accessToken);
    if (account.verification.status !== "approved") {
      throw new ConflictException({
        code: LaunchpadErrorCode.ISSUER_NOT_VERIFIED,
      });
    }

    const { data, error } = await this.supabase.client
      .from("launchpad_applications")
      .insert({
        account_id: account.account.id,
        status: "submitted",
        issuer_name: dto.issuer_name,
        issuer_country: dto.issuer_country,
        asset_name: dto.asset_name,
        asset_type: dto.asset_type,
        description: dto.description,
        target_amount: dto.target_amount,
        currency: dto.currency,
        min_ticket: dto.min_ticket,
        expected_yield_pct: dto.expected_yield_pct ?? null,
        term_months: dto.term_months ?? null,
        max_investors: dto.max_investors ?? null,
        offering_type: dto.offering_type,
        investor_countries: dto.investor_countries,
        accepts_us_investors: dto.accepts_us_investors,
        uses_mass_marketing: dto.uses_mass_marketing,
        milestones: dto.milestones,
        documents: dto.documents,
        ai_summary: null,
      })
      .select("*")
      .single();
    if (error || !data) throw this.dbError("application_insert", error);
    const view = toApplicationView(data as ApplicationRow);
    if (dto.assistant_session_id) {
      await this.finishAssistant(
        account.account.id,
        dto.assistant_session_id,
        view
      );
    }
    return view;
  }

  /**
   * Closes the assistant session (its files are deleted) and writes the reviewer
   * summary in the background, so submitting doesn't wait on the model.
   */
  private async finishAssistant(
    accountId: string,
    sessionId: string,
    view: ApplicationView
  ): Promise<void> {
    let transcript: Awaited<ReturnType<AssistantService["finishSession"]>> = [];
    try {
      transcript = await this.assistant.finishSession(accountId, sessionId);
    } catch (err) {
      this.logger.warn({
        event: "launchpad_assistant_close_failed",
        applicationId: view.id,
        error: String(err),
      });
    }
    void (async () => {
      try {
        const { id, account_id: _account, ...application } = view;
        const summary = await this.assistant.reviewSummary(
          application,
          transcript
        );
        if (!summary) return;
        const { error } = await this.supabase.client
          .from("launchpad_applications")
          .update({ ai_summary: summary })
          .eq("id", id);
        if (error) throw error;
      } catch (err) {
        this.logger.warn({
          event: "launchpad_ai_summary_failed",
          applicationId: view.id,
          error: String(err),
        });
      }
    })();
  }

  async listMine(accessToken: string): Promise<ApplicationView[]> {
    const account = await this.accounts.getByAccessToken(accessToken);
    const { data, error } = await this.supabase.client
      .from("launchpad_applications")
      .select("*")
      .eq("account_id", account.account.id)
      .order("created_at", { ascending: false });
    if (error) throw this.dbError("application_list_mine", error);
    return ((data ?? []) as ApplicationRow[]).map(toApplicationView);
  }

  async adminList(status?: ApplicationStatus): Promise<ApplicationView[]> {
    let query = this.supabase.client
      .from("launchpad_applications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw this.dbError("application_admin_list", error);
    return ((data ?? []) as ApplicationRow[]).map(toApplicationView);
  }

  async adminGet(id: string): Promise<AdminApplicationView> {
    const { data, error } = await this.supabase.client
      .from("launchpad_applications")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw this.dbError("application_admin_get", error);
    if (!data) {
      throw new NotFoundException({
        code: LaunchpadErrorCode.APPLICATION_NOT_FOUND,
      });
    }
    return this.toAdminView(data as ApplicationRow);
  }

  async adminDecide(
    id: string,
    dto: DecideApplicationDto,
    reviewer: string | null
  ): Promise<AdminApplicationView> {
    const { data: existing, error: lookupErr } = await this.supabase.client
      .from("launchpad_applications")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (lookupErr) throw this.dbError("application_decide_lookup", lookupErr);
    if (!existing) {
      throw new NotFoundException({
        code: LaunchpadErrorCode.APPLICATION_NOT_FOUND,
      });
    }

    const row = existing as ApplicationRow;
    if (!REVIEWABLE.has(row.status)) {
      throw new ConflictException({
        code: LaunchpadErrorCode.APPLICATION_NOT_REVIEWABLE,
      });
    }

    const needsNote =
      dto.decision === "rejected" || dto.decision === "changes_requested";
    const note = dto.note?.trim() ?? "";
    if (needsNote && !note) {
      throw new BadRequestException({
        message:
          "note is required when decision is rejected or changes_requested",
      });
    }

    const { data: updated, error: updateErr } = await this.supabase.client
      .from("launchpad_applications")
      .update({
        status: dto.decision,
        review_note: note || null,
        reviewed_by: reviewer,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (updateErr || !updated)
      throw this.dbError("application_decide_update", updateErr);
    return this.toAdminView(updated as ApplicationRow);
  }

  private async toAdminView(row: ApplicationRow): Promise<AdminApplicationView> {
    const { data: account, error: accountErr } = await this.supabase.client
      .from("launchpad_accounts")
      .select("*")
      .eq("id", row.account_id)
      .single();
    if (accountErr || !account)
      throw this.dbError("application_issuer_account", accountErr);

    const accountRow = account as AccountRow;
    const { data: verification, error: verificationErr } =
      await this.supabase.client
        .from("launchpad_verifications")
        .select("*")
        .eq("id", accountRow.verification_id)
        .single();
    if (verificationErr || !verification)
      throw this.dbError("application_issuer_verification", verificationErr);

    const { data: wallet, error: walletErr } = await this.supabase.client
      .from("launchpad_wallets")
      .select("*")
      .eq("account_id", accountRow.id)
      .maybeSingle();
    if (walletErr) throw this.dbError("application_issuer_wallet", walletErr);

    return {
      ...toApplicationView(row),
      issuer: {
        account_id: accountRow.id,
        email: accountRow.email,
        display_name: accountRow.display_name,
        verification: toVerificationView(verification as VerificationRow),
        wallet_address: wallet ? (wallet as WalletRow).address : null,
      },
    };
  }

  private dbError(op: string, error: unknown) {
    this.logger.error({ event: "launchpad_application_db_error", op, error });
    return new InternalServerErrorException({ code: ErrorCode.DB_ERROR });
  }
}
