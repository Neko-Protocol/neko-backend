import type {
  EtherfuseBondSymbol,
  EtherfuseYieldEntry,
} from "@neko-protocol/api-contracts";

export const BONDS_COST_URL = "https://api.etherfuse.com/lookup/bonds/cost";

export const TARGET_SYMBOLS: readonly EtherfuseBondSymbol[] = [
  "CETES",
  "USTRY",
  "TESOURO",
];

export const BOND_YIELDS_CACHE_TTL_MS = 3_600_000;

export const BOND_YIELDS_CACHE_CONTROL =
  "s-maxage=3600, stale-while-revalidate=7200";

interface BondCostRow {
  bond_symbol?: string;
  currency?: string;
  current_time?: string;
  current_basis_points?: number;
}

export class EtherfuseBondYieldsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EtherfuseBondYieldsError";
  }
}

function parseTimeMs(t: string | undefined): number {
  if (!t) return 0;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : 0;
}

function dedupeBestRow(rows: BondCostRow[]): BondCostRow | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, row) => {
    const bestT = parseTimeMs(best.current_time);
    const rowT = parseTimeMs(row.current_time);
    if (rowT > bestT) return row;
    if (rowT < bestT) return best;
    const bestBps = best.current_basis_points ?? 0;
    const rowBps = row.current_basis_points ?? 0;
    return rowBps > bestBps ? row : best;
  });
}

function rowToEntry(
  symbol: EtherfuseBondSymbol,
  row: BondCostRow
): EtherfuseYieldEntry {
  const bps = row.current_basis_points;
  const currency = row.currency?.trim();
  const lastUpdated = row.current_time?.trim();

  if (
    typeof bps !== "number" ||
    !Number.isFinite(bps) ||
    bps < 0 ||
    !currency ||
    !lastUpdated
  ) {
    throw new EtherfuseBondYieldsError(`Invalid bond cost row for ${symbol}`);
  }

  return {
    symbol,
    apy: bps / 100,
    currency,
    lastUpdated,
  };
}

export async function fetchBondsCost(): Promise<unknown> {
  const res = await fetch(BONDS_COST_URL);
  if (!res.ok) {
    throw new EtherfuseBondYieldsError(
      `Etherfuse HTTP ${res.status} ${res.statusText}`
    );
  }
  return res.json() as Promise<unknown>;
}

export function mapBondCostPayload(rawBody: unknown): EtherfuseYieldEntry[] {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw new EtherfuseBondYieldsError("Invalid bond cost payload");
  }

  const grouped: Partial<Record<EtherfuseBondSymbol, BondCostRow[]>> = {};

  for (const row of Object.values(rawBody as Record<string, BondCostRow>)) {
    const sym = row?.bond_symbol?.toUpperCase();
    if (!sym || !TARGET_SYMBOLS.includes(sym as EtherfuseBondSymbol)) {
      continue;
    }
    const key = sym as EtherfuseBondSymbol;
    if (!grouped[key]) grouped[key] = [];
    grouped[key]!.push(row);
  }

  return TARGET_SYMBOLS.map((symbol) => {
    const pick = dedupeBestRow(grouped[symbol] ?? []);
    if (!pick) {
      throw new EtherfuseBondYieldsError(
        `Missing bond cost data for ${symbol}`
      );
    }
    return rowToEntry(symbol, pick);
  });
}
