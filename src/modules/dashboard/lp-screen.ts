import { xdr, Address, rpc } from "@stellar/stellar-sdk";
import { throttledRpc, type PoolInfo } from "@neko/orchestrator";

interface LpCandidate {
  poolId: string;
  lpTokenAddress: string;
  type: PoolInfo["type"];
}

function buildBalanceLedgerKey(
  contractAddress: string,
  walletAddress: string
): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(contractAddress).toScAddress(),
      key: xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol("Balance"),
        new Address(walletAddress).toScVal(),
      ]),
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
}

function extractLpCandidates(pools: PoolInfo[]): LpCandidate[] {
  const candidates: LpCandidate[] = [];
  for (const pool of pools) {
    if (pool.type === "aqua") {
      const addr = pool.metadata?.shareTokenAddress as string | undefined;
      if (addr) {
        candidates.push({
          poolId: pool.id,
          lpTokenAddress: addr,
          type: pool.type,
        });
      }
    } else if (pool.type === "soroswap") {
      const addr = pool.metadata?.poolAddress as string | undefined;
      if (addr) {
        candidates.push({
          poolId: pool.id,
          lpTokenAddress: addr,
          type: pool.type,
        });
      }
    }
  }
  return candidates;
}

/**
 * Checks all LP/share token balances in a single getLedgerEntries call. Aqua
 * positions bypass the storage-key shortcut because their share-token layout
 * differs from SEP-41 and would otherwise be hidden right after a deposit.
 */
export async function batchCheckLpBalances(
  server: rpc.Server,
  pools: PoolInfo[],
  walletAddress: string
): Promise<Set<string>> {
  const candidates = extractLpCandidates(pools);
  if (!candidates.length) return new Set();

  const alwaysCheck = candidates.filter((c) => c.type === "aqua");
  const ledgerCandidates = candidates.filter((c) => c.type !== "aqua");

  if (!ledgerCandidates.length) {
    return new Set(alwaysCheck.map((c) => c.poolId));
  }

  const keys = ledgerCandidates.map((c) =>
    buildBalanceLedgerKey(c.lpTokenAddress, walletAddress)
  );

  try {
    const response = await throttledRpc(() => server.getLedgerEntries(...keys));
    const foundContracts = new Set<string>();
    for (const entry of response.entries) {
      try {
        const data = entry.val.contractData();
        const addr = Address.fromScAddress(data.contract()).toString();
        foundContracts.add(addr);
      } catch {
        // ignore malformed entries
      }
    }
    return new Set([
      ...alwaysCheck.map((c) => c.poolId),
      ...ledgerCandidates
        .filter((c) => foundContracts.has(c.lpTokenAddress))
        .map((c) => c.poolId),
    ]);
  } catch {
    // If the RPC call fails, fall back to "everyone could have a balance"
    // rather than hiding positions silently.
    return new Set(candidates.map((c) => c.poolId));
  }
}
