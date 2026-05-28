import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from "@nestjs/common";
import {
  FeeBumpTransaction,
  rpc,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { StellarRpcService } from "../stellar/stellar-rpc.service";
import { PreparedTxCache } from "./cache/prepared-tx-cache";
import { XdrValidator } from "./validation/xdr-validator";
import { SorobanErrorMapper } from "./errors/soroban-error.mapper";
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

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(
    private readonly rpc: StellarRpcService,
    private readonly validator: XdrValidator,
    private readonly cache: PreparedTxCache,
    private readonly errors: SorobanErrorMapper
  ) {}

  async prepare(
    dto: PrepareTransactionDto,
    ip: string,
    requestTraceId?: string
  ): Promise<TransactionPreparedDto> {
    const traceId = requestTraceId ?? randomUUID();
    const start = Date.now();

    const { hash, sourceAccount, passphrase, ops } =
      this.validator.parseAndValidate(dto.unsignedXdr);

    this.cache.set(sourceAccount, { hash, passphrase });

    this.logger.log({
      event: "tx_prepared",
      traceId,
      ip,
      sourceAccount,
      hash,
      opsCount: ops.length,
      labels: ops.map((o) => (o.kind === "invoke" ? o.label : "payment")),
      durationMs: Date.now() - start,
      outcome: "ok",
    });

    return { ok: true, hash };
  }

  async submit(
    dto: SubmitTransactionDto,
    ip: string,
    requestTraceId?: string
  ): Promise<TransactionStatusDto> {
    const traceId = requestTraceId ?? randomUUID();
    const start = Date.now();
    const passphrase = this.rpc.getNetworkPassphrase();

    let tx: Transaction | FeeBumpTransaction;
    try {
      tx = TransactionBuilder.fromXDR(dto.signedXdr, passphrase);
    } catch {
      throw new BadRequestException({ code: "INVALID_XDR", traceId });
    }
    if (tx instanceof FeeBumpTransaction) {
      this.logger.warn({
        event: "submit_rejected",
        reason: "fee_bump_not_allowed",
        traceId,
        ip,
      });
      throw new ForbiddenException({ code: "SUBMIT_REJECTED", traceId });
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
      return new ForbiddenException({ code: "SUBMIT_REJECTED", traceId });
    };

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
    });

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
          : { code: "RPC_ERROR", message: extractMessage(err) },
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
      return {
        status: "FAILED",
        hash,
        error: {
          code: "TRANSACTION_FAILED",
          message: isProd() ? undefined : failed.resultXdr?.toXDR("base64"),
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
