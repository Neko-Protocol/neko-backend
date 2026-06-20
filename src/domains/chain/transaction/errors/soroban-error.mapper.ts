import { HttpStatus, Injectable } from "@nestjs/common";
import { decodeSorobanError } from "@shared/stellar/errors/soroban-error.decoder";
import { SorobanContractException } from "@shared/stellar/errors/soroban-contract.exception";

const isProd = () => process.env.NODE_ENV === "production";

/**
 * Generic mapper from raw RPC / SDK errors → HttpException. Intentionally
 * protocol-agnostic; caller is responsible for any per-protocol enrichment.
 */
@Injectable()
export class SorobanErrorMapper {
  mapSendError(raw: unknown, traceId: string): SorobanContractException {
    const decoded = decodeSorobanError(raw);
    const status = this.statusFor(decoded.code);
    return new SorobanContractException(
      status,
      {
        code: decoded.code,
        traceId,
        details:
          decoded.contractErrorCode !== undefined
            ? { rawCode: decoded.contractErrorCode }
            : undefined,
        reason:
          typeof raw === "object" && raw && "message" in raw
            ? String((raw as { message?: unknown }).message)
            : undefined,
      },
      isProd()
    );
  }

  mapPollError(raw: unknown, traceId: string): SorobanContractException {
    return this.mapSendError(raw, traceId);
  }

  private statusFor(code: string): HttpStatus {
    switch (code) {
      case "BAD_SEQUENCE":
      case "SOURCE_ACCOUNT_NOT_FOUND":
      case "INSUFFICIENT_FEE":
      case "INSUFFICIENT_BALANCE":
      case "AUTH_FAILED":
        return HttpStatus.UNPROCESSABLE_ENTITY;
      case "SOROBAN_CONTRACT_ERROR":
        return HttpStatus.UNPROCESSABLE_ENTITY;
      case "HOST_OBJECT_MISSING":
        return HttpStatus.UNPROCESSABLE_ENTITY;
      default:
        return HttpStatus.UNPROCESSABLE_ENTITY;
    }
  }
}
