import { createHash } from "crypto";

/**
 * How an application's commercial terms become a vault's constructor
 * arguments. Must match neko-tokenization-hackmeridian/packages/stellar
 * (terms.ts, amounts.ts, deployments.ts) exactly: the issuer and the reviewer
 * see those numbers, and these are the ones that reach the ledger.
 */

export const USDC_DECIMALS = 7;
const SCALE = 10n ** BigInt(USDC_DECIMALS);
const BPS_DENOMINATOR = 10_000n;

/** Whole USDC (number or decimal string) to base units. Extra decimals are cut. */
export function toUnits(value: number | string): bigint {
  const text = typeof value === "number" ? value.toFixed(USDC_DECIMALS) : value;
  const trimmed = text.trim().replace(/,/g, "");
  if (!/^-?\d*(\.\d*)?$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    throw new Error(`Not an amount: ${value}`);
  }
  const negative = trimmed.startsWith("-");
  const [whole = "0", fraction = ""] = trimmed.replace("-", "").split(".");
  const units =
    BigInt(whole || "0") * SCALE +
    BigInt(fraction.slice(0, USDC_DECIMALS).padEnd(USDC_DECIMALS, "0"));
  return negative ? -units : units;
}

/** The annual yield prorated over the term, as simple interest, in bps. */
export function repaymentRateBps(yieldPct: number, termMonths: number): number {
  return Math.round((yieldPct * 100 * termMonths) / 12);
}

/** Principal plus interest, in base units. */
export function expectedRepayment(target: bigint, rateBps: number): bigint {
  return target + (target * BigInt(rateBps)) / BPS_DENOMINATOR;
}

/**
 * Split the total by percentage, rounding each share down; the last tranche
 * takes the remainder so they add up to exactly the total.
 */
export function splitTranches(total: bigint, percentages: number[]): bigint[] {
  if (percentages.length === 0) return [];
  const amounts = percentages.map(
    (pct) => (total * BigInt(Math.round(pct * 100))) / BPS_DENOMINATOR
  );
  const allButLast = amounts.slice(0, -1).reduce((sum, a) => sum + a, 0n);
  amounts[amounts.length - 1] = total - allButLast;
  return amounts;
}

export const TOKEN_SYMBOL_PATTERN = /^[A-Z0-9]{2,12}$/;

export function sha256(data: string | Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

/** A retry of the same application always targets the same vault. */
export function vaultIdFor(applicationId: string): string {
  return sha256(applicationId).toString("hex");
}

/** JSON with object keys sorted at every level, for a stable hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`
      );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Unix seconds for a `YYYY-MM-DD` or ISO date. */
export function unixSeconds(date: string): number {
  const ms = Date.parse(date.length === 10 ? `${date}T00:00:00Z` : date);
  if (Number.isNaN(ms)) throw new Error(`Not a date: ${date}`);
  return Math.floor(ms / 1000);
}
