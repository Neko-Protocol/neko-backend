import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "crypto";
import { ErrorCode } from "@neko-protocol/api-contracts";
import {
  DiditErrorCode,
  type DiditCreateSessionInput,
  type DiditDecision,
  type DiditIdentity,
  type DiditSession,
} from "./didit.types";

const DEFAULT_BASE_URL = "https://verification.didit.me";
const WEBHOOK_MAX_SKEW_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 15_000;

export type VerificationStatus =
  | "pending"
  | "in_progress"
  | "in_review"
  | "approved"
  | "declined"
  | "expired";

@Injectable()
export class DiditService {
  private readonly logger = new Logger(DiditService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private get apiKey(): string | undefined {
    return this.config.get<string>("DIDIT_API_KEY")?.trim() || undefined;
  }

  private get baseUrl(): string {
    const raw = this.config.get<string>("DIDIT_BASE_URL")?.trim();
    return (raw || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  async createSession(input: DiditCreateSessionInput): Promise<DiditSession> {
    return this.request<DiditSession>("POST", "/v3/session/", {
      workflow_id: input.workflowId,
      vendor_data: input.vendorData,
      ...(input.callback ? { callback: input.callback } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
  }

  async getDecision(sessionId: string): Promise<DiditDecision> {
    return this.request<DiditDecision>(
      "GET",
      `/v3/session/${encodeURIComponent(sessionId)}/decision/`
    );
  }

  verifyWebhook(
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
    nowSeconds = Math.floor(Date.now() / 1000)
  ): boolean {
    const secret = this.config.get<string>("DIDIT_WEBHOOK_SECRET")?.trim();
    if (!secret || !rawBody) return false;

    const timestamp = Number(header(headers, "x-timestamp"));
    if (
      !Number.isFinite(timestamp) ||
      Math.abs(nowSeconds - timestamp) > WEBHOOK_MAX_SKEW_SECONDS
    ) {
      return false;
    }

    const rawSig = hmac(secret, rawBody);
    if (
      matches(rawSig, header(headers, "x-signature")) ||
      matches(rawSig, header(headers, "x-signature-previous"))
    ) {
      return true;
    }

    let canonical: string;
    try {
      canonical = JSON.stringify(
        sortKeys(JSON.parse(rawBody.toString("utf8")))
      );
    } catch {
      return false;
    }
    const v2Sig = hmac(secret, Buffer.from(canonical, "utf8"));
    return (
      matches(v2Sig, header(headers, "x-signature-v2")) ||
      matches(v2Sig, header(headers, "x-signature-v2-previous"))
    );
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<T> {
    const apiKey = this.apiKey;
    if (!apiKey) {
      throw new ServiceUnavailableException({
        code: ErrorCode.NOT_CONFIGURED,
        message: "Didit is not configured",
      });
    }
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "x-api-key": apiKey,
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw this.unavailable(path, err instanceof Error ? err.message : err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw this.unavailable(path, `HTTP ${res.status} ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  private unavailable(path: string, reason: unknown) {
    this.logger.error({ event: "didit_request_failed", path, reason });
    return new ServiceUnavailableException({
      code: DiditErrorCode.DIDIT_UNAVAILABLE,
    });
  }
}

export function mapDiditStatus(status: string | undefined): VerificationStatus {
  switch ((status ?? "").trim().toLowerCase()) {
    case "approved":
      return "approved";
    case "declined":
      return "declined";
    case "in review":
      return "in_review";
    case "in progress":
    case "awaiting user":
    case "resubmitted":
      return "in_progress";
    case "expired":
    case "kyc expired":
    case "abandoned":
      return "expired";
    default:
      return "pending";
  }
}

export function extractIdentity(decision: DiditDecision): DiditIdentity {
  const id = decision.id_verifications?.find(Boolean);
  const company = decision.registry_checks?.find((c) => c?.company)?.company;
  const joined = [id?.first_name, id?.last_name].filter(Boolean).join(" ");
  return {
    fullName: id?.full_name || joined || null,
    businessName: company?.company_name || null,
    country:
      company?.country_code || id?.issuing_state || id?.nationality || null,
  };
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function hmac(secret: string, payload: Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function matches(expected: string, presented: string | undefined): boolean {
  if (!presented) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])])
    );
  }
  return value;
}
