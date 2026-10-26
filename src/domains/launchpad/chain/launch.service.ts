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
import { AccountsService } from "../accounts.service";
import type { LaunchApplicationDto } from "../dto/launch-application.dto";
import {
  LaunchpadErrorCode,
  toApplicationView,
  type ApplicationRow,
  type ApplicationView,
  type DeploymentRow,
  type LaunchStep,
  type WalletRow,
} from "../launchpad.types";
import { LaunchpadChainService, type Platform } from "./chain.service";
import { ChainCallError, arg } from "./soroban";
import {
  TOKEN_SYMBOL_PATTERN,
  canonicalJson,
  expectedRepayment,
  repaymentRateBps,
  sha256,
  splitTranches,
  toUnits,
  unixSeconds,
  vaultIdFor,
} from "./terms";

const DEPLOYMENTS = "launchpad_deployments";

/** Recorded instead of a tx hash when a step had nothing left to do. */
export const SKIPPED = "skipped";

// Contract error codes the launch tolerates on a retry.
const FACTORY_VAULT_EXISTS = 1;
const TRACKER_VAULT_EXISTS = 1;
/** stellar-tokens `TokenBinderError::TokenAlreadyBound`. */
const TOKEN_ALREADY_BOUND = 331;

interface FactoryDeployment {
  token: string;
  compliance: string;
  vault: string;
  wired: boolean;
}

/**
 * Turns an approved application into a live vault: the factory deploys the
 * token, compliance contract and vault, then the token is wired, bound and
 * registered with the milestone tracker. Every step is idempotent, so a failed
 * launch resumes from where it stopped when the issuer calls it again.
 */
@Injectable()
export class LaunchService {
  private readonly logger = new Logger(LaunchService.name);
  /** Applications with a launch running in this process. */
  private readonly running = new Set<string>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly accounts: AccountsService,
    private readonly chain: LaunchpadChainService
  ) {}

  async launch(
    accessToken: string,
    applicationId: string,
    dto: LaunchApplicationDto
  ): Promise<ApplicationView> {
    const account = await this.accounts.getByAccessToken(accessToken);
    const app = await this.loadApplication(applicationId);
    if (!app || app.account_id !== account.account.id) {
      throw new NotFoundException({
        code: LaunchpadErrorCode.APPLICATION_NOT_FOUND,
      });
    }
    if (app.status !== "approved") {
      throw new ConflictException({
        code: LaunchpadErrorCode.APPLICATION_NOT_APPROVED,
      });
    }

    const existing = embedded(app);
    if (existing?.status === "live") return toApplicationView(app);
    if (this.running.has(app.id)) {
      throw new ConflictException({
        code: LaunchpadErrorCode.LAUNCH_IN_PROGRESS,
      });
    }

    // Once the vault exists its symbol and deadline are on the ledger; a
    // resume keeps them whatever the request says.
    const created = Boolean(existing?.steps?.create_vault);
    const symbol = created ? existing!.token_symbol : dto.token_symbol;
    const deadline = created
      ? existing!.funding_deadline
      : dto.funding_deadline;
    if (!created) assertLaunchTerms(app, symbol, deadline);

    const platform = await this.chain.platform();
    const issuer = await this.issuerWallet(app.account_id);
    if (!(await this.chain.hasUsdcTrustline(issuer))) {
      throw new ConflictException({
        code: LaunchpadErrorCode.TRUSTLINE_MISSING,
        message: `The issuer wallet needs a ${platform.usdcAsset.getCode()} trustline before launch.`,
      });
    }

    this.running.add(app.id);
    try {
      let row = await this.upsertDeployment(app.id, existing, {
        token_symbol: symbol,
        funding_deadline: new Date(deadline).toISOString(),
      });
      row = await this.runSteps(platform, app, issuer, row);
      this.logger.log({
        event: "launchpad_launch_finished",
        applicationId: app.id,
        status: row.status,
      });
    } finally {
      this.running.delete(app.id);
    }
    return toApplicationView((await this.loadApplication(app.id))!);
  }

  private async runSteps(
    p: Platform,
    app: ApplicationRow,
    issuer: string,
    initial: DeploymentRow
  ): Promise<DeploymentRow> {
    let row = initial;
    const manager = p.manager.publicKey();
    const record = async (
      step: LaunchStep,
      hash: string,
      extra: Partial<DeploymentRow> = {}
    ) => {
      row = await this.updateDeployment(row.id, {
        ...extra,
        steps: { ...row.steps, [step]: hash },
      });
    };

    const steps: Array<[LaunchStep, () => Promise<void>]> = [
      [
        "create_vault",
        async () => {
          try {
            const sent = await p.soroban.invoke<FactoryDeployment>(
              p.manager,
              p.factory,
              "create_vault",
              this.createVaultArgs(p, app, issuer, row)
            );
            await record("create_vault", sent.hash, contracts(sent.result));
          } catch (error) {
            if (codeOf(error) !== FACTORY_VAULT_EXISTS) throw error;
            const onChain = await this.readDeployment(p, row.vault_id);
            await record("create_vault", SKIPPED, contracts(onChain));
          }
        },
      ],
      [
        "wire_vault",
        async () => {
          const onChain = await this.readDeployment(p, row.vault_id);
          if (onChain.wired) return record("wire_vault", SKIPPED);
          const sent = await p.soroban.invoke(
            p.manager,
            p.factory,
            "wire_vault",
            [arg.bytes32(row.vault_id), arg.address(manager)]
          );
          await record("wire_vault", sent.hash);
        },
      ],
      [
        "accept_admin",
        async () => {
          if (!p.admin) return record("accept_admin", SKIPPED);
          const admin = await p.soroban.read<string | null>(
            row.token!,
            "get_admin"
          );
          if (admin === p.platformAdmin) return record("accept_admin", SKIPPED);
          const sent = await p.soroban.invoke(
            p.admin,
            row.token!,
            "accept_admin_transfer"
          );
          await record("accept_admin", sent.hash);
        },
      ],
      [
        "bind_compliance",
        () =>
          this.bind(p, row.compliance!, row.token!, (h) =>
            record("bind_compliance", h)
          ),
      ],
      [
        "bind_registry",
        () =>
          this.bind(p, p.identityRegistry, row.token!, (h) =>
            record("bind_registry", h)
          ),
      ],
      [
        "register_milestones",
        async () => {
          try {
            const sent = await p.soroban.invoke(
              p.manager,
              p.milestoneTracker,
              "register_vault",
              [
                arg.bytes32(row.vault_id),
                arg.address(row.token!),
                arg.address(issuer),
                arg.vec(app.milestones.map((m) => arg.string(m.title))),
                arg.address(manager),
              ]
            );
            await record("register_milestones", sent.hash);
          } catch (error) {
            if (codeOf(error) !== TRACKER_VAULT_EXISTS) throw error;
            await record("register_milestones", SKIPPED);
          }
        },
      ],
    ];

    for (const [step, run] of steps) {
      if (row.steps?.[step]) continue;
      try {
        await run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn({
          event: "launchpad_launch_step_failed",
          applicationId: app.id,
          step,
          error: message,
        });
        return this.updateDeployment(row.id, {
          status: "failed",
          error: { step, message: message.slice(0, 500) },
        });
      }
    }

    return this.updateDeployment(row.id, {
      status: "live",
      error: null,
      launched_at: new Date().toISOString(),
    });
  }

  private async bind(
    p: Platform,
    binder: string,
    token: string,
    record: (hash: string) => Promise<void>
  ): Promise<void> {
    try {
      const sent = await p.soroban.invoke(p.manager, binder, "bind_token", [
        arg.address(token),
        arg.address(p.manager.publicKey()),
      ]);
      await record(sent.hash);
    } catch (error) {
      if (codeOf(error) !== TOKEN_ALREADY_BOUND) throw error;
      await record(SKIPPED);
    }
  }

  private createVaultArgs(
    p: Platform,
    app: ApplicationRow,
    issuer: string,
    row: DeploymentRow
  ) {
    const target = toUnits(app.target_amount);
    const total = expectedRepayment(
      target,
      repaymentRateBps(Number(app.expected_yield_pct), Number(app.term_months))
    );
    const amounts = splitTranches(
      total,
      app.milestones.map((m) => m.amount_pct)
    );
    const { launchpad_deployments: _deployment, ...metadata } = app;

    const request = arg.struct({
      vault_id: arg.bytes32(row.vault_id),
      issuer: arg.address(issuer),
      name: arg.string(app.asset_name),
      symbol: arg.string(row.token_symbol),
      metadata_hash: arg.bytes32(
        sha256(canonicalJson(metadata)).toString("hex")
      ),
      metadata_uri: arg.string(
        `${p.publicApiUrl}/v1/launchpad/opportunities/${app.id}`
      ),
    });
    const terms = arg.struct({
      usdc: arg.address(p.usdc),
      borrower: arg.address(issuer),
      target: arg.i128(target),
      min_target: arg.i128(toUnits(app.min_target!)),
      expected_repayment: arg.i128(total),
      funding_deadline: arg.u64(unixSeconds(row.funding_deadline)),
      exit_fee_bps: arg.u32(p.exitFeeBps),
      max_exit_fee_bps: arg.u32(p.maxExitFeeBps),
      fee_recipient: arg.address(p.platformAdmin),
    });
    const tranches = arg.vec(
      app.milestones.map((m, i) =>
        arg.struct({
          expected_amount: arg.i128(amounts[i]),
          due_date: arg.u64(unixSeconds(m.due!)),
        })
      )
    );
    return [request, terms, tranches, arg.address(p.manager.publicKey())];
  }

  private readDeployment(p: Platform, vaultId: string) {
    return p.soroban.read<FactoryDeployment>(p.factory, "get_deployment", [
      arg.bytes32(vaultId),
    ]);
  }

  private async loadApplication(id: string): Promise<ApplicationRow | null> {
    const { data, error } = await this.supabase.client
      .from("launchpad_applications")
      .select(`*, ${DEPLOYMENTS}(*)`)
      .eq("id", id)
      .maybeSingle();
    if (error) throw this.dbError("launch_application", error);
    return (data as ApplicationRow | null) ?? null;
  }

  private async issuerWallet(accountId: string): Promise<string> {
    const { data, error } = await this.supabase.client
      .from("launchpad_wallets")
      .select("*")
      .eq("account_id", accountId)
      .maybeSingle();
    if (error) throw this.dbError("launch_wallet", error);
    if (!data) {
      throw new ConflictException({
        code: LaunchpadErrorCode.ISSUER_WALLET_MISSING,
      });
    }
    return (data as WalletRow).address;
  }

  private async upsertDeployment(
    applicationId: string,
    existing: DeploymentRow | null,
    terms: Pick<DeploymentRow, "token_symbol" | "funding_deadline">
  ): Promise<DeploymentRow> {
    if (existing) {
      return this.updateDeployment(existing.id, {
        ...terms,
        status: "launching",
        error: null,
      });
    }
    const { data, error } = await this.supabase.client
      .from(DEPLOYMENTS)
      .insert({
        application_id: applicationId,
        vault_id: vaultIdFor(applicationId),
        status: "launching",
        steps: {},
        ...terms,
      })
      .select("*")
      .single();
    if (error || !data) throw this.dbError("deployment_insert", error);
    return data as DeploymentRow;
  }

  private async updateDeployment(
    id: string,
    values: Partial<DeploymentRow>
  ): Promise<DeploymentRow> {
    const { data, error } = await this.supabase.client
      .from(DEPLOYMENTS)
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) throw this.dbError("deployment_update", error);
    return data as DeploymentRow;
  }

  private dbError(op: string, error: unknown) {
    this.logger.error({ event: "launchpad_launch_db_error", op, error });
    return new InternalServerErrorException({ code: ErrorCode.DB_ERROR });
  }
}

/** Checks that only matter before the vault exists. */
export function assertLaunchTerms(
  app: ApplicationRow,
  symbol: string,
  deadline: string,
  now: Date = new Date()
): void {
  const fail = (message: string) => {
    throw new BadRequestException({ message });
  };
  if (!TOKEN_SYMBOL_PATTERN.test(symbol)) {
    fail("token_symbol must be 2 to 12 capital letters or digits");
  }
  const deadlineMs = Date.parse(deadline);
  if (Number.isNaN(deadlineMs) || deadlineMs <= now.getTime()) {
    fail("funding_deadline must be in the future");
  }
  if (app.min_target == null) {
    fail("The application has no minimum raise; ask for changes first.");
  }
  if (app.expected_yield_pct == null || app.term_months == null) {
    fail("The application needs a yield and a term before it can launch.");
  }
  if (app.milestones.length === 0 || app.milestones.some((m) => !m.due)) {
    fail("Every repayment needs a due date before the application can launch.");
  }
  if (
    deadlineMs >= Date.parse(`${app.milestones[0].due!.slice(0, 10)}T00:00:00Z`)
  ) {
    fail("funding_deadline must be before the first repayment is due");
  }
}

function embedded(app: ApplicationRow): DeploymentRow | null {
  const d = app.launchpad_deployments;
  return (Array.isArray(d) ? d[0] : d) ?? null;
}

function contracts(d: FactoryDeployment): Partial<DeploymentRow> {
  return { token: d.token, compliance: d.compliance, vault: d.vault };
}

function codeOf(error: unknown): number | null {
  return error instanceof ChainCallError ? error.code : null;
}
