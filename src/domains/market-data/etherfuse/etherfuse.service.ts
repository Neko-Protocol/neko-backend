import { BadGatewayException, Injectable } from "@nestjs/common";
import { RedisCacheService } from "../../../core/cache/redis-cache.service";
import { ErrorCode, type EtherfuseYieldEntry } from "@neko/api-contracts";
import {
  BOND_YIELDS_CACHE_TTL_MS,
  EtherfuseBondYieldsError,
  fetchBondsCost,
  mapBondCostPayload,
} from "./etherfuse.utils";

@Injectable()
export class EtherfuseService {
  constructor(private readonly cache: RedisCacheService) {}

  async getBondYields(): Promise<EtherfuseYieldEntry[]> {
    try {
      const { value } = await this.cache.through(
        "etherfuse:bond-yields",
        BOND_YIELDS_CACHE_TTL_MS,
        async () => mapBondCostPayload(await fetchBondsCost())
      );
      return value;
    } catch (err) {
      const message =
        err instanceof EtherfuseBondYieldsError
          ? err.message
          : "Etherfuse bond yields unavailable";
      throw new BadGatewayException({
        code: ErrorCode.ETHERFUSE_BOND_YIELDS_UNAVAILABLE,
        message,
      });
    }
  }
}
