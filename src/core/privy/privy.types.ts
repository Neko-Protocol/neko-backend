export interface PrivyPrincipal {
  userId: string;
  sessionId: string;
}

export interface PrivyStellarWallet {
  address: string;
  walletId: string | null;
}

export interface PrivyUserProfile {
  userId: string;
  email: string | null;
  stellarWallets: PrivyStellarWallet[];
}

export const PrivyErrorCode = {
  PRIVY_TOKEN_INVALID: "PRIVY_TOKEN_INVALID",
  PRIVY_UNAVAILABLE: "PRIVY_UNAVAILABLE",
} as const;
