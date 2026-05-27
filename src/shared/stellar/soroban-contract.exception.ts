import { HttpException, HttpStatus } from "@nestjs/common";

export interface SorobanContractExceptionDetails {
  code: string;
  traceId?: string;
  /** Extra info kept only in dev/non-prod responses. */
  details?: Record<string, unknown>;
  /** Always logged server-side, never returned in prod. */
  reason?: string;
}

/**
 * Base HttpException for transaction-relay errors. In production, detail
 * fields are dropped from the response body so the client only sees the
 * opaque `code` + `traceId`. Internal `reason` is logged separately.
 */
export class SorobanContractException extends HttpException {
  readonly traceId?: string;
  readonly reason?: string;
  readonly internalDetails?: Record<string, unknown>;

  constructor(
    status: HttpStatus,
    payload: SorobanContractExceptionDetails,
    isProduction: boolean
  ) {
    const body: Record<string, unknown> = { code: payload.code };
    if (payload.traceId) body.traceId = payload.traceId;
    if (!isProduction && payload.details) body.details = payload.details;
    super(body, status);
    this.traceId = payload.traceId;
    this.reason = payload.reason;
    this.internalDetails = payload.details;
  }
}
