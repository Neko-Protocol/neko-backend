/**
 * Wire types returned by the dashboard endpoints. `bigint` values from the
 * orchestrator are serialized as strings so the JSON survives transport.
 */

export interface DashboardTokenInfo {
  address: string;
  code: string;
  name: string;
  decimals: number;
}

export interface DashboardPoolInfo {
  id: string;
  type: "blend" | "neko" | "soroswap" | "aqua" | "custom";
  name: string;
  tokens: DashboardTokenInfo[];
  tvl: string;
  apy: number;
  state: "active" | "frozen" | "on_ice" | "unknown";
  supportedActions: string[];
  metadata: Record<string, unknown>;
}

export interface DashboardPoolPosition {
  poolId: string;
  deposited: string;
  depositedFormatted: string;
  rewards: string;
  rewardsFormatted: string;
  metadata: Record<string, unknown>;
}

export interface DashboardPoolPositionEntry {
  pool: DashboardPoolInfo;
  position: DashboardPoolPosition;
}

export interface DashboardVaultPosition {
  vaultId: string;
  userShares: string;
  pricePerShare: string;
}

export interface DashboardPositionsResponse {
  poolPositions: DashboardPoolPositionEntry[];
  vaultPositions: DashboardVaultPosition[];
  fetchedAt: number;
}

export interface DashboardPoolCatalogResponse {
  blend: DashboardPoolInfo[];
  aqua: DashboardPoolInfo[];
  soroswap: DashboardPoolInfo[];
  fetchedAt: number;
}

export type DashboardPriceSource =
  | "reflector"
  | "soroswap"
  | "coingecko"
  | "horizon"
  | "fallback"
  | "unknown";

export interface DashboardPricesResponse {
  prices: Record<string, { price: number; source: DashboardPriceSource }>;
  fetchedAt: number;
}
