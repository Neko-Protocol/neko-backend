import type { WalletKind, WalletNetwork } from "@neko-protocol/api-contracts";

/** Identity provider name stored in account_identities.provider. */
export const PRIVY_PROVIDER = "privy";

export interface AccountRow {
  id: string;
  email: string | null;
  display_name: string | null;
  country: string | null;
  locale: string | null;
  terms_version: string | null;
  terms_accepted_at: string | null;
  created_at: string;
}

export interface WalletRow {
  id: string;
  account_id: string;
  chain: "stellar";
  network: WalletNetwork;
  address: string;
  kind: WalletKind;
  provider: string | null;
  provider_wallet_id: string | null;
  is_primary: boolean;
  created_at: string;
}

export interface WalletActivationRow {
  wallet_id: string;
  network: WalletNetwork;
  sponsor_address: string;
  status: "pending" | "activated" | "failed";
  tx_hash: string | null;
  error: string | null;
}
