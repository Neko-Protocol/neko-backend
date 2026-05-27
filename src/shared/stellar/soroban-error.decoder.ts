/**
 * SorobanErrorDecoder
 *
 * Pure helper for pulling a stable `code` out of the various error shapes
 * the Soroban RPC and SDK throw. We deliberately keep this protocol-agnostic
 * — per-protocol error code mapping (Blend, DeFindex, Aqua…) is the caller's
 * job, not ours.
 */

export interface DecodedSorobanError {
  /** Stable identifier we can use to map → HttpException downstream. */
  code: string;
  /** Free-form details, never logged client-side in production. */
  raw?: unknown;
  /** Raw u32 error code from a `ScError` Contract variant, if present. */
  contractErrorCode?: number;
}

const HOST_OBJ_NOT_EXIST = /HostObjNotExist|HostObjectNotExist/i;
const TX_INSUFFICIENT_FEE = /insufficient.+fee/i;
const TX_BAD_SEQ = /tx_bad_seq|bad_sequence|BadSeq/i;
const TX_NO_ACCOUNT = /tx_no_account|account.+not.+found/i;
const TX_INSUFFICIENT_BALANCE = /tx_insufficient_balance|insufficient.+balance/i;
const TX_AUTH_FAILED = /auth.+failed|missing.+auth|authorization/i;
const CONTRACT_ERROR_NUM = /Contract\((\d+)\)|HostError:[^,]*Contract,\s*Error\((\d+)\)|ScError:Contract.*code:?\s*(\d+)/i;

export function decodeSorobanError(raw: unknown): DecodedSorobanError {
  const message = extractMessage(raw);

  const contractMatch = message.match(CONTRACT_ERROR_NUM);
  if (contractMatch) {
    const codeStr = contractMatch[1] ?? contractMatch[2] ?? contractMatch[3];
    const code = Number(codeStr);
    if (!Number.isNaN(code)) {
      return {
        code: "SOROBAN_CONTRACT_ERROR",
        contractErrorCode: code,
        raw,
      };
    }
  }

  if (HOST_OBJ_NOT_EXIST.test(message)) {
    return { code: "HOST_OBJECT_MISSING", raw };
  }
  if (TX_INSUFFICIENT_FEE.test(message)) {
    return { code: "INSUFFICIENT_FEE", raw };
  }
  if (TX_BAD_SEQ.test(message)) {
    return { code: "BAD_SEQUENCE", raw };
  }
  if (TX_NO_ACCOUNT.test(message)) {
    return { code: "SOURCE_ACCOUNT_NOT_FOUND", raw };
  }
  if (TX_INSUFFICIENT_BALANCE.test(message)) {
    return { code: "INSUFFICIENT_BALANCE", raw };
  }
  if (TX_AUTH_FAILED.test(message)) {
    return { code: "AUTH_FAILED", raw };
  }

  return { code: "SOROBAN_UNKNOWN_ERROR", raw };
}

function extractMessage(raw: unknown): string {
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  if (raw instanceof Error) return raw.message;
  if (typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (typeof r.message === "string") return r.message;
    if (typeof r.errorResultXdr === "string") return r.errorResultXdr;
    if (typeof r.status === "string") return r.status;
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}
