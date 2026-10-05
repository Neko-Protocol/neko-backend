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
