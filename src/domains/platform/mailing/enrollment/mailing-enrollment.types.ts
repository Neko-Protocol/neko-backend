export type EnrollmentCandidate = {
  /** Null for admin-list recipients, who have no wallet. */
  wallet_address: string | null;
  email: string;
  trigger_at: string; // ISO timestamp
};
