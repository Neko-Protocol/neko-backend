import { randomUUID } from "node:crypto";
import {
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  FeeBumpTransaction,
  rpc,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { ErrorCode } from "@neko-protocol/api-contracts";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";
import { SponsorService, assetId } from "@core/stellar/sponsor.service";
import {
  TRUSTLINES_REQUIRED,
  TrustlineResolver,
} from "@core/stellar/trustline-resolver";
import { PreparedTxCache } from "./cache/prepared-tx-cache";
import { XdrValidator, type ValidatedOp } from "./validation/xdr-validator";
import { SorobanErrorMapper } from "./errors/soroban-error.mapper";
import { DashboardCache } from "@domains/platform/dashboard/cache/dashboard-cache";
import {
  decodeTransactionResultXdr,
  formatDecodedResult,
} from "@shared/stellar/errors/transaction-result.decoder";
import { NotificationsService } from "@domains/platform/notifications/notifications.service";
import { PrepareTransactionDto } from "./dto/prepare-transaction.dto";
import { SubmitTransactionDto } from "./dto/submit-transaction.dto";
import { TransactionPreparedDto } from "./dto/transaction-prepared.dto";
import {
  TransactionStatus,
  TransactionStatusDto,
} from "./dto/transaction-status.dto";

const POLL_TIMEOUT_MS = 25_000;
const POLL_INTERVAL_MS = 1_500;

const isProd = () => process.env.NODE_ENV === "production";

export interface RelayOptions {
  sponsorFor?: string;
}

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(
    private readonly rpc: StellarRpcService,
    private readonly validator: XdrValidator,
    private readonly cache: PreparedTxCache,
    private readonly errors: SorobanErrorMapper,
    private readonly dashboardCache: DashboardCache,
    private readonly sponsor: SponsorService,
    private readonly trustlines: TrustlineResolver,
    private readonly notifications: NotificationsService
  ) {}

  /**
   * In-app + push "transaction confirmed" for the wallet that signed it.
   * Deduped per hash, so a resubmitted transaction notifies once. Not awaited:
   * the relay response shouldn't wait on notification delivery.
   */
  private notifyConfirmed(wallet: string, hash: string): void {
    void this.notifications.emit({
      trigger: "tx_confirmed",
      walletAddress: wallet,
      dedupeKey: `tx:${hash}`,
      params: { hash },
    });
  }

  /**
   * Drops this wallet's cached dashboard entries after it moves funds.
   *
   * The positions cache is keyed per wallet and read straight through, so
   * without this a deposit stayed invisible until the entry aged out — the one
   * moment a user is actually watching for it. Best effort: a failed
   * invalidation costs staleness, never the transaction, which has already
   * settled by the time this runs.
   */
  private async dropDashboardCache(wallet: string): Promise<void> {
    try {
      await Promise.all([
        this.dashboardCache.invalidate(`positions:${wallet}`),
        this.dashboardCache.invalidate(`vault-positions:${wallet}`),
      ]);
    } catch (err) {
      this.logger.warn({
        event: "dashboard_cache_invalidate_failed",
        wallet,
        reason: extractMessage(err),
      });
    }
  }

  async prepare(
    dto: PrepareTransactionDto,
    ip: string,
    requestTraceId?: string,
    opts: RelayOptions = {}
  ): Promise<TransactionPreparedDto> {
    const traceId = requestTraceId ?? randomUUID();
    const start = Date.now();

    const { tx, hash, sourceAccount, passphrase, ops } =
      this.validator.parseAndValidate(dto.unsignedXdr);

    if (opts.sponsorFor !== undefined && sourceAccount !== opts.sponsorFor) {
      this.logger.warn({
        event: "prepare_rejected",
        reason: "source_not_caller_wallet",
        traceId,
        ip,
        sourceAccount,
      });
      throw new ForbiddenException({
        code: ErrorCode.PREPARE_REJECTED,
        traceId,
      });
    }

    if (opts.sponsorFor !== undefined) {
      await this.assertSponsorable(tx, ops, traceId);
    }

    this.cache.set(sourceAccount, { hash, passphrase });

    this.logger.log({
      event: "tx_prepared",
      traceId,
      ip,
      sourceAccount,
      hash,
      opsCount: ops.length,
      labels: ops.map((o) => (o.kind === "invoke" ? o.label : o.kind)),
      durationMs: Date.now() - start,
      outcome: "ok",
    });

    return { ok: true, hash };
  }

  async submit(
    dto: SubmitTransactionDto,
    ip: string,
    requestTraceId?: string,
    opts: RelayOptions = {}
  ): Promise<TransactionStatusDto> {
    const traceId = requestTraceId ?? randomUUID();
    const start = Date.now();
    const passphrase = this.rpc.getNetworkPassphrase();

    let tx: Transaction | FeeBumpTransaction;
    try {
      tx = TransactionBuilder.fromXDR(dto.signedXdr, passphrase);
    } catch {
      throw new BadRequestException({ code: ErrorCode.INVALID_XDR, traceId });
    }
    if (tx instanceof FeeBumpTransaction) {
      this.logger.warn({
        event: "submit_rejected",
        reason: "fee_bump_not_allowed",
        traceId,
        ip,
      });
      throw new ForbiddenException({
        code: ErrorCode.SUBMIT_REJECTED,
        traceId,
      });
    }

    const sourceAccount = tx.source;
    const recomputedHash = tx.hash().toString("hex");

    const reject = (reason: string) => {
      this.logger.warn({
        event: "submit_rejected",
        reason,
        traceId,
        ip,
        sourceAccount,
        hash: recomputedHash,
      });
      return new ForbiddenException({
        code: ErrorCode.SUBMIT_REJECTED,
        traceId,
      });
    };

    if (opts.sponsorFor !== undefined && sourceAccount !== opts.sponsorFor) {
      throw reject("source_not_caller_wallet");
    }

    const cached = this.cache.consume(sourceAccount);
    if (!cached) throw reject("prepare_expired_or_missing");
    if (cached.hash !== recomputedHash) throw reject("hash_mismatch");
    if (cached.passphrase !== passphrase) throw reject("passphrase_mismatch");

    this.logger.log({
      event: "submit_accepted",
      traceId,
      ip,
      sourceAccount,
      hash: recomputedHash,
      sponsored: opts.sponsorFor !== undefined,
    });

    const outgoing =
      opts.sponsorFor !== undefined ? this.sponsor.feeBump(tx) : tx;
    const result = await this.sendAndWait(outgoing, traceId, start);
    await this.dropDashboardCache(sourceAccount);
    if (result.status === "SUCCESS") {
      this.notifyConfirmed(sourceAccount, result.hash);
    }
    return result;
  }

  private async assertSponsorable(
    tx: Transaction,
    ops: ValidatedOp[],
    traceId: string
  ): Promise<void> {
    if (ops.every((op) => op.kind !== "invoke")) {
      this.assertSponsorableClassicSwap(tx, ops, traceId);
      this.sponsor.quoteFeeBump(tx);
      return;
    }
    if (ops.some((op) => op.kind !== "invoke")) {
      throw new UnprocessableEntityException({
        code: ErrorCode.DISALLOWED_OPERATION,
        traceId,
      });
    }

    let sim: rpc.Api.SimulateTransactionResponse;
    try {
      sim = await this.rpc.rpc.simulateTransaction(tx);
    } catch (err) {
      this.logger.warn({
        event: "sponsor_simulation_error",
        traceId,
        reason: extractMessage(err),
      });
      throw new UnprocessableEntityException({
        code: ErrorCode.SIMULATION_FAILED,
        traceId,
      });
    }
    if (rpc.Api.isSimulationError(sim)) {
      await this.assertNoMissingTrustlines(tx, sim, traceId);
      throw new UnprocessableEntityException({
        code: ErrorCode.SIMULATION_FAILED,
        traceId,
        ...(isProd() ? {} : { details: { error: sim.error } }),
      });
    }

    this.sponsor.assertResourceFeeMatchesSimulation(
      tx,
      Number(sim.minResourceFee)
    );
    this.sponsor.quoteFeeBump(tx);
  }

  private assertSponsorableClassicSwap(
    tx: Transaction,
    ops: ValidatedOp[],
    traceId: string
  ): void {
    const user = tx.source;
    const referral = this.sponsor.swapReferralAddress();
    const fromUser = (op: { source?: string }) =>
      op.source === undefined || op.source === user;

    const allowed =
      ops.some((op) => op.kind === "pathPayment") &&
      ops.every((op) => {
        if (!fromUser(op as { source?: string })) return false;
        if (op.kind === "pathPayment") return op.destination === user;
        if (op.kind === "payment") {
          return referral !== null && op.destination === referral;
        }
        return false;
      }) &&
      ops.filter((op) => op.kind === "payment").length <= 1;

    if (!allowed) {
      this.logger.warn({
        event: "sponsor_classic_rejected",
        traceId,
        sourceAccount: user,
        ops: ops.map((op) => op.kind),
      });
      throw new UnprocessableEntityException({
        code: ErrorCode.DISALLOWED_OPERATION,
        traceId,
      });
    }
  }

  private async assertNoMissingTrustlines(
    tx: Transaction,
    sim: rpc.Api.SimulateTransactionResponse,
    traceId: string
  ): Promise<void> {
    const contracts = this.trustlines.missingTrustlineContracts(sim, tx.source);
    if (contracts.length === 0) return;

    const assets: string[] = [];
    for (const contractId of contracts) {
      const asset = await this.trustlines.assetForContract(contractId);
      if (asset) assets.push(assetId(asset));
    }
    if (assets.length === 0) return;

    this.logger.log({
      event: "prepare_trustlines_required",
      traceId,
      sourceAccount: tx.source,
      assets,
    });
    throw new ConflictException({
      code: TRUSTLINES_REQUIRED,
      traceId,
      publicDetails: { assets },
    });
  }

  async sendAndWait(
    tx: Transaction | FeeBumpTransaction,
    traceId: string,
    start = Date.now()
  ): Promise<TransactionStatusDto> {
    const recomputedHash = tx.hash().toString("hex");

    let sendResp: rpc.Api.SendTransactionResponse;
    try {
      sendResp = await this.rpc.sendTransaction(tx);
    } catch (err) {
      this.logger.error({
        event: "send_transaction_error",
        traceId,
        hash: recomputedHash,
        reason: extractMessage(err),
      });
      throw this.errors.mapSendError(err, traceId);
    }

    if (sendResp.status === "ERROR") {
      this.logger.warn({
        event: "send_transaction_rejected",
        traceId,
        hash: sendResp.hash,
        rpcStatus: sendResp.status,
      });
      throw this.errors.mapSendError(sendResp, traceId);
    }

    if (sendResp.status === "DUPLICATE") {
      // RPC already saw this tx — return current status without polling.
      const status = await this.getStatus(sendResp.hash);
      this.logger.log({
        event: "submit_resolved",
        traceId,
        hash: sendResp.hash,
        status: status.status,
        outcome: "duplicate",
        durationMs: Date.now() - start,
      });
      return { ...status, traceId };
    }

    const result = await this.pollGetTransaction(sendResp.hash, traceId);
    this.logger.log({
      event: "submit_resolved",
      traceId,
      hash: sendResp.hash,
      status: result.status,
      durationMs: Date.now() - start,
      outcome: result.status === "SUCCESS" ? "ok" : "non_success",
    });
    return { ...result, traceId };
  }

  async getStatus(hash: string): Promise<TransactionStatusDto> {
    const traceId = randomUUID();
    try {
      const resp = await this.rpc.getTransaction(hash);
      return this.toStatusDto(hash, resp, traceId);
    } catch (err) {
      this.logger.warn({
        event: "get_transaction_error",
        traceId,
        hash,
        reason: extractMessage(err),
      });
      return {
        status: "NOT_FOUND",
        hash,
        traceId,
        error: isProd()
          ? undefined
          : { code: ErrorCode.RPC_ERROR, message: extractMessage(err) },
      };
    }
  }

  private async pollGetTransaction(
    hash: string,
    traceId: string
  ): Promise<TransactionStatusDto> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const resp = await this.rpc.getTransaction(hash);
        if (resp.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) {
          return this.toStatusDto(hash, resp, traceId);
        }
      } catch (err) {
        this.logger.debug({
          event: "poll_get_transaction_warn",
          traceId,
          hash,
          reason: extractMessage(err),
        });
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return { status: "PENDING", hash, traceId };
  }

  private toStatusDto(
    hash: string,
    resp: rpc.Api.GetTransactionResponse,
    traceId?: string
  ): TransactionStatusDto {
    if (resp.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      const success = resp as rpc.Api.GetSuccessfulTransactionResponse;
      return {
        status: "SUCCESS",
        hash,
        returnValue: success.returnValue
          ? success.returnValue.toXDR("base64")
          : undefined,
        traceId,
      };
    }
    if (resp.status === rpc.Api.GetTransactionStatus.FAILED) {
      const failed = resp as rpc.Api.GetFailedTransactionResponse;
      const decoded = decodeTransactionResultXdr(failed.resultXdr);
      return {
        status: "FAILED",
        hash,
        error: {
          code: ErrorCode.TRANSACTION_FAILED,
          message: decoded ? formatDecodedResult(decoded) : undefined,
        },
        traceId,
      };
    }
    return { status: mapStatus(resp.status), hash, traceId };
  }
}

function mapStatus(s: rpc.Api.GetTransactionStatus): TransactionStatus {
  switch (s) {
    case rpc.Api.GetTransactionStatus.SUCCESS:
      return "SUCCESS";
    case rpc.Api.GetTransactionStatus.FAILED:
      return "FAILED";
    case rpc.Api.GetTransactionStatus.NOT_FOUND:
    default:
      return "NOT_FOUND";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractMessage(raw: unknown): string {
  if (!raw) return "";
  if (raw instanceof Error) return raw.message;
  if (typeof raw === "string") return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}
