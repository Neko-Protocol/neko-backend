import {
  BadGatewayException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ErrorCode } from "@neko-protocol/api-contracts";
import { SupabaseService } from "@core/supabase/supabase.service";
import {
  LaunchpadErrorCode,
  type ApplicationRow,
  type DeploymentRow,
} from "../launchpad.types";
import { LaunchpadChainService } from "./chain.service";
import { ChainCallError, arg } from "./soroban";
import { sha256 } from "./terms";

export interface ChainActionResult {
  tx_hash: string;
}

/**
 * Manager-signed actions an admin takes on a live vault: closing the round,
 * releasing the raise to the issuer and reviewing milestone evidence.
 */
@Injectable()
export class VaultOpsService {
  private readonly logger = new Logger(VaultOpsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly chain: LaunchpadChainService
  ) {}

  /** `Funded` at or above the minimum raise, `Failed` below it. */
  async closeFunding(applicationId: string): Promise<ChainActionResult> {
    const { deployment } = await this.liveDeployment(applicationId);
    return this.invokeVault(applicationId, deployment.vault!, "close_funding");
  }

  /** Sends the raise to the issuer and starts the repayment period. */
  async release(applicationId: string): Promise<ChainActionResult> {
    const { deployment } = await this.liveDeployment(applicationId);
    return this.invokeVault(applicationId, deployment.vault!, "release");
  }

  async reviewMilestone(
    applicationId: string,
    index: number,
    approved: boolean,
    note: string
  ): Promise<ChainActionResult> {
    const { deployment, app } = await this.liveDeployment(applicationId);
    if (index < 0 || index >= app.milestones.length) {
      throw new NotFoundException({ message: `No milestone ${index}` });
    }
    const p = await this.chain.platform();
    return this.run(applicationId, "review_milestone", () =>
      p.soroban.invoke(p.manager, p.milestoneTracker, "review_milestone", [
        arg.bytes32(deployment.vault_id),
        arg.u32(index),
        arg.bool(approved),
        arg.bytes32(sha256(note.trim()).toString("hex")),
        arg.address(p.manager.publicKey()),
      ])
    );
  }

  private async invokeVault(
    applicationId: string,
    vault: string,
    method: "close_funding" | "release"
  ): Promise<ChainActionResult> {
    const p = await this.chain.platform();
    return this.run(applicationId, method, () =>
      p.soroban.invoke(p.manager, vault, method, [
        arg.address(p.manager.publicKey()),
      ])
    );
  }

  private async run(
    applicationId: string,
    action: string,
    call: () => Promise<{ hash: string }>
  ): Promise<ChainActionResult> {
    try {
      const sent = await call();
      this.logger.log({
        event: "launchpad_vault_action",
        applicationId,
        action,
        tx: sent.hash,
      });
      return { tx_hash: sent.hash };
    } catch (error) {
      if (!(error instanceof ChainCallError)) throw error;
      this.logger.warn({
        event: "launchpad_vault_action_failed",
        applicationId,
        action,
        error: error.message,
      });
      // A contract refusal (wrong state, too early) is the caller's to fix; a
      // network failure is ours.
      const body = {
        code: LaunchpadErrorCode.CHAIN_CALL_FAILED,
        contract_error: error.code,
        message: error.message.slice(0, 500),
      };
      throw error.code != null
        ? new ConflictException(body)
        : new BadGatewayException(body);
    }
  }

  private async liveDeployment(
    applicationId: string
  ): Promise<{ app: ApplicationRow; deployment: DeploymentRow }> {
    const { data, error } = await this.supabase.client
      .from("launchpad_applications")
      .select("*, launchpad_deployments(*)")
      .eq("id", applicationId)
      .maybeSingle();
    if (error) {
      this.logger.error({ event: "launchpad_vault_ops_db_error", error });
      throw new InternalServerErrorException({ code: ErrorCode.DB_ERROR });
    }
    if (!data) {
      throw new NotFoundException({
        code: LaunchpadErrorCode.APPLICATION_NOT_FOUND,
      });
    }
    const app = data as ApplicationRow;
    const embedded = app.launchpad_deployments;
    const deployment = Array.isArray(embedded) ? embedded[0] : embedded;
    if (!deployment || deployment.status !== "live" || !deployment.vault) {
      throw new ConflictException({
        code: LaunchpadErrorCode.DEPLOYMENT_NOT_LIVE,
      });
    }
    return { app, deployment };
  }
}
