import { BadGatewayException, Injectable } from "@nestjs/common";
import type { EtherfuseYieldEntry } from "@neko/api-contracts";
import {
  BOND_YIELDS_CACHE_TTL_MS,
  EtherfuseBondYieldsError,
  fetchBondsCost,
  mapBondCostPayload,
} from "./etherfuse.utils";

@Injectable()
export class EtherfuseService {
  private cache: { expiresAt: number; value: EtherfuseYieldEntry[] } | null =
    null;

  async getBondYields(): Promise<EtherfuseYieldEntry[]> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.value;
    }

    try {
      const body = await fetchBondsCost();
      const entries = mapBondCostPayload(body);
      this.cache = {
        value: entries,
        expiresAt: now + BOND_YIELDS_CACHE_TTL_MS,
      };
      return entries;
    } catch (err) {
      const message =
        err instanceof EtherfuseBondYieldsError
          ? err.message
          : "Etherfuse bond yields unavailable";
      throw new BadGatewayException({
        code: "ETHERFUSE_BOND_YIELDS_UNAVAILABLE",
        message,
      });
    }
  }
}
