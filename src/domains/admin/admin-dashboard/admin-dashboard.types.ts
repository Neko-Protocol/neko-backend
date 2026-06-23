export type AuditLog = {
  id: string;
  wallet_address: string;
  action_type: string;
  asset_in: string | null;
  asset_out: string | null;
  amount_in: number | null;
  token_amount_in: number | null;
  amount_out: number | null;
  pool_id: string | null;
  network: string;
  tx_hash: string | null;
  created_at: string;
};

export interface OverviewStats {
  totalUsers: number;
  newUsersThisWeek: number;
  totalTransactions: number;
  totalVolumeUsd: number;
  activeWalletsThisWeek: number;
}
