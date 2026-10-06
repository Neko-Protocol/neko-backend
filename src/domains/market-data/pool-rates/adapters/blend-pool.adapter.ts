import { PoolV2 } from "@blend-capital/blend-sdk";
import { BLEND_ASSET_CODES, BLEND_POOL_VAULTS } from "./blend-config";
import { getBlndPriceUsd, computeBlendEmissionsApy } from "./blend-emissions";

export interface PoolRateRow {
  pool_id: string;
  supply_apy: number;
  borrow_apy: number | null;
}

export class BlendPoolAdapter {
  constructor(
    private readonly poolContractId: string,
    private readonly network: { rpc: string; passphrase: string }
  ) {}

  async fetchRates(): Promise<PoolRateRow[]> {
    try {
      const pool = await PoolV2.load(this.network, this.poolContractId);
      let blndPrice = 0;
      try {
        blndPrice = await getBlndPriceUsd(pool.metadata.backstop, this.network);
      } catch {
        // Price stays 0, which skips emissions APY; base rates are still saved.
      }

      const rows: PoolRateRow[] = [];

      for (const [assetAddress, reserve] of pool.reserves.entries()) {
        const isVaultPool =
          !!BLEND_POOL_VAULTS[`${this.poolContractId}:${assetAddress}`];
        let emissionsApy: number | null = null;
        if (reserve.supplyEmissions && !isVaultPool) {
          emissionsApy = await computeBlendEmissionsApy(
            reserve,
            pool,
            assetAddress,
            blndPrice
          );
        }

        const supplyApy = reserve.estSupplyApy * 100 + (emissionsApy ?? 0);
        const borrowApy = reserve.estBorrowApy * 100;

        rows.push({
          pool_id: `blend:${this.poolContractId}:${assetAddress}`,
          supply_apy: supplyApy,
          borrow_apy: borrowApy,
        });
      }

      return rows;
    } catch {
      return [];
    }
  }
}

// Re-export so service can reference it without importing from the index
export { BLEND_ASSET_CODES };
