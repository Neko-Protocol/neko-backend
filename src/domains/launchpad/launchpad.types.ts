import type { VerificationStatus } from "@core/didit/didit.service";

/** The Launchpad demo runs on testnet regardless of the backend's STELLAR_NETWORK. */
export const LAUNCHPAD_NETWORK = "testnet" as const;

export const CLAIM_TOKEN_HEADER = "x-claim-token";

export type VerificationKind = "kyc" | "kyb";
export type VerificationProvider = "didit" | "mock";

export const LaunchpadErrorCode = {
  VERIFICATION_NOT_FOUND: "VERIFICATION_NOT_FOUND",
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  MISSING_ACCESS_TOKEN: "MISSING_ACCESS_TOKEN",
  VERIFICATION_NOT_APPROVED: "VERIFICATION_NOT_APPROVED",
  VERIFICATION_ALREADY_CLAIMED: "VERIFICATION_ALREADY_CLAIMED",
  CLAIM_TOKEN_INVALID: "CLAIM_TOKEN_INVALID",
  EMAIL_IN_USE: "EMAIL_IN_USE",
  WORKFLOW_NOT_CONFIGURED: "WORKFLOW_NOT_CONFIGURED",
  WEBHOOK_SIGNATURE_INVALID: "WEBHOOK_SIGNATURE_INVALID",
} as const;

export interface VerificationRow {
  id: string;
  kind: VerificationKind;
  provider: VerificationProvider;
  provider_session_id: string | null;
  status: VerificationStatus;
  full_name: string | null;
  business_name: string | null;
  country: string | null;
  decision: unknown;
  claim_token_hash: string;
  claimed_at: string | null;
  network: string;
  created_at: string;
  updated_at: string;
}

export interface AccountRow {
  id: string;
  email: string;
  privy_user_id: string;
  display_name: string | null;
  verification_id: string;
  created_at: string;
}

export interface WalletRow {
  id: string;
  account_id: string;
  verification_id: string;
  chain: "stellar";
  network: string;
  address: string;
  kind: "embedded" | "external";
  provider: string;
  provider_wallet_id: string | null;
  funded_at: string | null;
  funding_tx_hash: string | null;
  created_at: string;
}

export interface VerificationView {
  id: string;
  kind: VerificationKind;
  provider: VerificationProvider;
  status: VerificationStatus;
  full_name: string | null;
  business_name: string | null;
  country: string | null;
  claimed: boolean;
}

export interface StartedVerification {
  verification: VerificationView;
  session_url: string | null;
  claim_token: string;
}

export interface LaunchpadAccountView {
  account: {
    id: string;
    email: string;
    display_name: string | null;
    privy_user_id: string;
  };
  verification: VerificationView;
  wallet: {
    address: string;
    network: string;
    funded: boolean;
    funding_tx_hash: string | null;
  };
}

export function toVerificationView(row: VerificationRow): VerificationView {
  return {
    id: row.id,
    kind: row.kind,
    provider: row.provider,
    status: row.status,
    full_name: row.full_name,
    business_name: row.business_name,
    country: row.country,
    claimed: Boolean(row.claimed_at),
  };
}
