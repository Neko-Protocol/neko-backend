import { Injectable } from "@nestjs/common";
import { xdr } from "@stellar/stellar-sdk";

export interface PoolEvent {
  id: string;
  type: string;
  user: string | null;
  asset: string | null;
  amount: number | null;
  ts: number;
}

function extractContractId(poolId: string): string {
  if (poolId.startsWith("aqua:")) return poolId.replace("aqua:", "");
  if (poolId.startsWith("blend:")) return poolId.split(":")[1];
  return poolId;
}

function tryDecodeAmount(bodyXdrBase64: string): number | null {
  try {
    const val = xdr.ScVal.fromXDR(bodyXdrBase64, "base64");

    // Body may be a vec — take first element
    let target = val;
    if (val.switch().name === "scvVec") {
      const vec = val.vec();
      if (!vec?.length) return null;
      target = vec[0];
    }

    if (target.switch().name === "scvI128") {
      const parts = target.i128();
      const hi = Number(String(parts.hi()));
      if (hi !== 0) return null; // too large to represent safely
      return Number(String(parts.lo())) / 1e7;
    }

    if (target.switch().name === "scvU128") {
      const parts = target.u128();
      const hi = Number(String(parts.hi()));
      if (hi !== 0) return null;
      return Number(String(parts.lo())) / 1e7;
    }

    return null;
  } catch {
    return null;
  }
}

@Injectable()
export class ContractActivityService {
  async getActivity(poolId: string): Promise<PoolEvent[]> {
    const contractId = extractContractId(decodeURIComponent(poolId));
    const url = `https://api.stellar.expert/explorer/public/contract/${contractId}/events?limit=200&order=desc`;

    let json: unknown;
    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      json = await res.json();
    } catch {
      return [];
    }

    const records =
      (json as { _embedded?: { records?: unknown[] } })?._embedded?.records ??
      [];

    return (
      records as {
        id: string;
        ts: number;
        initiator?: string;
        topics?: string[];
        bodyXdr?: string;
      }[]
    ).map((r) => {
      const topics = r.topics ?? [];
      // topics[0] = event name, topics[1] = asset contract, topics[2] = user
      const asset = topics[1]?.startsWith("C") ? topics[1] : null;
      const user = topics[2]?.startsWith("G")
        ? topics[2]
        : (r.initiator ?? null);
      const amount = r.bodyXdr ? tryDecodeAmount(r.bodyXdr) : null;

      return {
        id: r.id,
        type: topics[0] ?? "event",
        user,
        asset,
        amount: amount !== null ? parseFloat(amount.toFixed(4)) : null,
        ts: r.ts,
      };
    });
  }
}
