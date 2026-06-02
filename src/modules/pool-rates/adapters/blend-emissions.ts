import { Backstop, PoolV2, type Reserve } from "@blend-capital/blend-sdk";

export type PoolReserve = Reserve;

export async function getBlndPriceUsd(
  backstopId: string,
  network: { rpc: string; passphrase: string }
): Promise<number> {
  try {
    const backstop = await Backstop.load(network, backstopId);
    const bt = backstop.backstopToken;
    const blnd = Number(bt.blnd);
    const usdc = Number(bt.usdc);
    if (blnd === 0) return 0;
    return (usdc * 4) / blnd;
  } catch {
    return 0;
  }
}

export async function computeBlendEmissionsApy(
  reserve: PoolReserve,
  pool: PoolV2,
  assetAddress: string,
  blndPriceUsd: number
): Promise<number | null> {
  if (!reserve.supplyEmissions || blndPriceUsd <= 0) return null;

  try {
    let assetPriceUsd = 1;
    try {
      const oracle = await pool.loadOracle();
      assetPriceUsd = oracle.getPriceFloat(assetAddress) ?? 1;
    } catch {
      assetPriceUsd = 1;
    }

    if (assetPriceUsd <= 0 || !Number.isFinite(assetPriceUsd)) return null;

    const blndPerYearPerToken =
      reserve.supplyEmissions.emissionsPerYearPerToken(
        reserve.data.bSupply,
        reserve.config.decimals
      );

    return ((blndPerYearPerToken * blndPriceUsd) / assetPriceUsd) * 100;
  } catch {
    return null;
  }
}
