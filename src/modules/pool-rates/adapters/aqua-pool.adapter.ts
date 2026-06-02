import { AQUA_API_BASE, getAquaPoolAddresses } from "./aqua-config";
import type { PoolRateRow } from "./blend-pool.adapter";

interface AquaApiPool {
  address: string;
  total_apy: string | number;
  [key: string]: unknown;
}

interface AquaApiResponse {
  items?: AquaApiPool[];
  results?: AquaApiPool[];
}

export class AquaPoolAdapter {
  async fetchRates(): Promise<PoolRateRow[]> {
    const addresses = getAquaPoolAddresses();
    const url = `${AQUA_API_BASE}/pools/?address__in=${addresses.join(",")}`;

    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const json = (await res.json()) as AquaApiResponse;
      const pools: AquaApiPool[] = json.items ?? json.results ?? [];

      return pools.map((p) => ({
        pool_id: `aqua:${p.address}`,
        supply_apy: parseFloat(String(p.total_apy ?? "0")) * 100,
        borrow_apy: null,
      }));
    } catch {
      return [];
    }
  }
}
