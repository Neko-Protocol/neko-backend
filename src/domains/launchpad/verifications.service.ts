import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ErrorCode } from "@neko-protocol/api-contracts";
import { SupabaseService } from "@core/supabase/supabase.service";
import {
  DiditService,
  extractIdentity,
  mapDiditStatus,
  type VerificationStatus,
} from "@core/didit/didit.service";
import type { DiditWebhookPayload } from "@core/didit/didit.types";
import { claimTokenMatches, newClaimToken } from "./claim-token";
import {
  LAUNCHPAD_NETWORK,
  LaunchpadErrorCode,
  toVerificationView,
  type StartedVerification,
  type VerificationApp,
  type VerificationKind,
  type VerificationRow,
  type VerificationView,
} from "./launchpad.types";

const TABLE = "launchpad_verifications";
const FINAL_STATUSES: ReadonlySet<VerificationStatus> = new Set([
  "approved",
  "declined",
  "expired",
]);

@Injectable()
export class VerificationsService {
  private readonly logger = new Logger(VerificationsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly didit: DiditService,
    private readonly config: ConfigService
  ) {}

  isMockEnabled(): boolean {
    return this.config.get<string>("KYC_MOCK_ENABLED")?.trim() === "true";
  }

  async start(
    kind: VerificationKind,
    app: VerificationApp = "launchpad"
  ): Promise<StartedVerification> {
    const workflowId = this.workflowId(kind);
    if (!this.didit.isConfigured() || !workflowId) {
      throw new ServiceUnavailableException({
        code: LaunchpadErrorCode.WORKFLOW_NOT_CONFIGURED,
        message: `Didit ${kind.toUpperCase()} workflow is not configured`,
      });
    }

    const { token, hash } = newClaimToken();
    const row = await this.insert({
      kind,
      provider: "didit",
      status: "pending",
      claim_token_hash: hash,
    });

    let session;
    try {
      session = await this.didit.createSession({
        workflowId,
        vendorData: row.id,
        callback: this.callbackUrl(app),
        metadata: { verification_id: row.id, kind },
      });
    } catch (err) {
      await this.supabase.client.from(TABLE).delete().eq("id", row.id);
      throw err;
    }

    const updated = await this.update(row.id, {
      provider_session_id: session.session_id,
      status: mapDiditStatus(session.status),
    });
    return {
      verification: toVerificationView(updated),
      session_url: session.url,
      claim_token: token,
    };
  }

  async startMock(
    kind: VerificationKind,
    name: string
  ): Promise<StartedVerification> {
    if (!this.isMockEnabled()) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND });
    }
    const clean = name.trim();
    const { token, hash } = newClaimToken();
    const row = await this.insert({
      kind,
      provider: "mock",
      status: "approved",
      full_name: kind === "kyc" ? clean : null,
      business_name: kind === "kyb" ? clean : null,
      decision: { mock: true, name: clean },
      claim_token_hash: hash,
    });
    return {
      verification: toVerificationView(row),
      session_url: null,
      claim_token: token,
    };
  }

  async get(
    id: string,
    claimToken: string | undefined
  ): Promise<VerificationView> {
    return toVerificationView(await this.authorize(id, claimToken));
  }

  async authorize(
    id: string,
    claimToken: string | undefined
  ): Promise<VerificationRow> {
    const row = await this.find(id);
    if (!row) {
      throw new NotFoundException({
        code: LaunchpadErrorCode.VERIFICATION_NOT_FOUND,
      });
    }
    if (!claimTokenMatches(claimToken, row.claim_token_hash)) {
      throw new UnauthorizedException({
        code: LaunchpadErrorCode.CLAIM_TOKEN_INVALID,
      });
    }
    return this.refresh(row);
  }

  async markClaimed(id: string): Promise<VerificationRow> {
    return this.update(id, { claimed_at: new Date().toISOString() });
  }

  async handleWebhook(payload: DiditWebhookPayload): Promise<void> {
    const sessionId = payload.session_id;
    if (!sessionId) return;
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select("*")
      .eq("provider_session_id", sessionId)
      .maybeSingle();
    if (error) throw this.dbError("webhook_lookup", error);
    if (!data) {
      this.logger.warn({ event: "didit_webhook_unknown_session", sessionId });
      return;
    }
    // Re-fetch instead of trusting the payload's decision block.
    await this.refresh(data as VerificationRow, true);
  }

  private async refresh(
    row: VerificationRow,
    force = false
  ): Promise<VerificationRow> {
    if (
      row.provider !== "didit" ||
      !row.provider_session_id ||
      (!force && FINAL_STATUSES.has(row.status))
    ) {
      return row;
    }
    let decision;
    try {
      decision = await this.didit.getDecision(row.provider_session_id);
    } catch (err) {
      // Serve the stored status; the next poll or webhook retries.
      this.logger.warn({ event: "didit_decision_refresh_failed", id: row.id });
      if (force) throw err;
      return row;
    }
    const identity = extractIdentity(decision);
    return this.update(row.id, {
      status: mapDiditStatus(decision.status),
      full_name: identity.fullName ?? row.full_name,
      business_name: identity.businessName ?? row.business_name,
      country: identity.country ?? row.country,
      decision,
    });
  }

  private workflowId(kind: VerificationKind): string | undefined {
    const key =
      kind === "kyc" ? "DIDIT_KYC_WORKFLOW_ID" : "DIDIT_KYB_WORKFLOW_ID";
    return this.config.get<string>(key)?.trim() || undefined;
  }

  private callbackUrl(app: VerificationApp): string | undefined {
    const key = app === "pro" ? "PRO_APP_URL" : "LAUNCHPAD_APP_URL";
    const base = this.config.get<string>(key)?.trim();
    return base ? `${base.replace(/\/+$/, "")}/didit-callback` : undefined;
  }

  async find(id: string): Promise<VerificationRow | null> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw this.dbError("find", error);
    return (data as VerificationRow | null) ?? null;
  }

  private async insert(
    values: Partial<VerificationRow>
  ): Promise<VerificationRow> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .insert({ network: LAUNCHPAD_NETWORK, ...values })
      .select("*")
      .single();
    if (error || !data) throw this.dbError("insert", error);
    return data as VerificationRow;
  }

  private async update(
    id: string,
    values: Partial<VerificationRow>
  ): Promise<VerificationRow> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .update(values)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) throw this.dbError("update", error);
    return data as VerificationRow;
  }

  private dbError(op: string, error: unknown) {
    this.logger.error({ event: "launchpad_verification_db_error", op, error });
    return new InternalServerErrorException({ code: ErrorCode.DB_ERROR });
  }
}
