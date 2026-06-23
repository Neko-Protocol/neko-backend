export type DestinationKind = "pool" | "vault" | "yield-token";

export type RecommendedStrategy = {
  id: string;
  name: string;
  description: string | null;
  token_code: string;
  destination_kind: DestinationKind;
  destination_id: string;
  stack_kind: DestinationKind | null;
  stack_id: string | null;
  amount: number | null;
  snapshot_apy: number | null;
  position: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** camelCase shape consumed by the public simulator endpoint. */
export type PublicRecommendedStrategy = {
  id: string;
  name: string;
  description: string | null;
  tokenCode: string;
  destinationKind: DestinationKind;
  destinationId: string;
  stackKind: DestinationKind | null;
  stackId: string | null;
  amount: string | null;
  snapshotApy: number | null;
};

export type CatalogDestination = {
  kind: DestinationKind;
  id: string;
  name: string;
  protocol: string;
  apy: number | null;
  acceptedTokenCodes: string[];
};

const DESTINATION_KIND_SET = new Set<string>(["pool", "vault", "yield-token"]);

export function isDestinationKind(x: string): x is DestinationKind {
  return DESTINATION_KIND_SET.has(x);
}
