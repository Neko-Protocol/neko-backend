import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  BLEND_VAULT_ONLY_RESERVES,
  throttledRpc,
  type PoolInfo,
  type PoolPosition,
} from "@neko/orchestrator";
import { parseAllVaultIds, type StellarPriceService } from "@neko/keeper";
import { Client as DefindexVaultClient } from "@neko/defindex-vault";
import { OrchestratorService } from "@core/orchestrator/orchestrator.service";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";
import { STELLAR_PRICE_SERVICE } from "@domains/market-data/asset-prices/asset-prices.tokens";
import { DashboardCache } from "./cache/dashboard-cache";
import { batchCheckLpBalances } from "./lp-screen";
import type {
  DashboardPoolCatalogResponse,
  DashboardPoolInfo,
  DashboardPoolPosition,
  DashboardPoolPositionEntry,
  DashboardPositionsResponse,
  DashboardPricesResponse,
  DashboardVaultPosition,
} from "./dashboard.types";

const TTL_POSITIONS_MS = 30_000;
const TTL_POOL_CATALOG_MS = 5 * 60_000;
const TTL_PRICES_MS = 60_000;

const POOL_CATALOG_LIMITS = { blend: 5, aqua: 5 } as const;
const ONE_SHARE = 1_000_000_000_000n;

type SdkResultLike = { unwrap?: () => unknown; tag?: string; value?: unknown };
function unwrapResult<T>(result: unknown, fallback: T): T {
  if (result === null || result === undefined) return fallback;
  const r = result as SdkResultLike;
  if (typeof r.unwrap === "function") {
    try {
      return r.unwrap() as T;
    } catch {
      return fallback;
    }
  }
  if (r.tag === "ok") return r.value as T;
  return result as T;
}

function sanitizeBigInts(obj: unknown): unknown {
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(sanitizeBigInts);
  if (obj !== null && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = sanitizeBigInts(v);
    }
    return out;
  }
  return obj;
}

function serializePool(pool: PoolInfo): DashboardPoolInfo {
  return {
    id: pool.id,
    type: pool.type,
    name: pool.name,
    tokens: pool.tokens,
    tvl: pool.tvl.toString(),
    apy: pool.apy,
    state: pool.state,
    supportedActions: pool.supportedActions,
    metadata: sanitizeBigInts(pool.metadata) as Record<string, unknown>,
  };
}

function serializePosition(position: PoolPosition): DashboardPoolPosition {
  return {
    poolId: position.poolId,
    deposited: position.deposited.toString(),
    depositedFormatted: position.depositedFormatted,
    rewards: position.rewards.toString(),
    rewardsFormatted: position.rewardsFormatted,
    metadata: sanitizeBigInts(position.metadata) as Record<string, unknown>,
  };
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly orchestratorSvc: OrchestratorService,
    private readonly stellar: StellarRpcService,
    private readonly cache: DashboardCache,
    private readonly config: ConfigService,
    @Inject(STELLAR_PRICE_SERVICE)
    private readonly priceService: StellarPriceService
  ) {}

  getPositions(wallet: string): Promise<DashboardPositionsResponse> {
    return this.cache.getOrFetch(`positions:${wallet}`, TTL_POSITIONS_MS, () =>
      this.loadPositions(wallet)
    );
  }

  getPoolCatalog(): Promise<DashboardPoolCatalogResponse> {
    return this.cache.getOrFetch("pool-catalog", TTL_POOL_CATALOG_MS, () =>
      this.loadPoolCatalog()
    );
  }

  async getPrices(symbols: string[]): Promise<DashboardPricesResponse> {
    const unique = Array.from(new Set(symbols.filter(Boolean))).sort();
    if (unique.length === 0) {
      return { prices: {}, fetchedAt: Date.now() };
    }

    const entries = await Promise.all(
      unique.map((symbol) => this.fetchSinglePrice(symbol))
    );

    const prices: DashboardPricesResponse["prices"] = {};
    for (const entry of entries) {
      if (entry)
        prices[entry.symbol] = { price: entry.price, source: entry.source };
    }
    return { prices, fetchedAt: Date.now() };
  }

  private fetchSinglePrice(symbol: string) {
    return this.cache.getOrFetch(`price:${symbol}`, TTL_PRICES_MS, async () => {
      try {
        const { price, source } =
          await this.priceService.getPriceWithSource(symbol);
        return {
          symbol,
          price,
          source: (source ??
            "unknown") as DashboardPricesResponse["prices"][string]["source"],
        };
      } catch (err) {
        this.logger.warn(
          `[dashboard] price fetch failed for ${symbol}: ${(err as Error).message}`
        );
        return null;
      }
    });
  }

  private async loadPoolCatalog(): Promise<DashboardPoolCatalogResponse> {
    const orchestrator = this.orchestratorSvc.orchestrator;
    const [blend, aqua] = await Promise.all([
      orchestrator
        .getPoolsByType("blend", POOL_CATALOG_LIMITS.blend)
        .catch((e) => {
          this.logger.warn(
            `[dashboard] blend pools failed: ${(e as Error).message}`
          );
          return [] as PoolInfo[];
        }),
      orchestrator
        .getPoolsByType("aqua", POOL_CATALOG_LIMITS.aqua)
        .catch((e) => {
          this.logger.warn(
            `[dashboard] aqua pools failed: ${(e as Error).message}`
          );
          return [] as PoolInfo[];
        }),
    ]);

    return {
      blend: blend.map(serializePool),
      aqua: aqua.map(serializePool),
      fetchedAt: Date.now(),
    };
  }

  private async loadPositions(
    wallet: string
  ): Promise<DashboardPositionsResponse> {
    const [poolEntries, vaultPositions] = await Promise.all([
      this.loadPoolPositions(wallet),
      this.loadVaultPositions(wallet),
    ]);
    return {
      poolPositions: poolEntries,
      vaultPositions,
      fetchedAt: Date.now(),
    };
  }

  private async loadPoolPositions(
    wallet: string
  ): Promise<DashboardPoolPositionEntry[]> {
    const orchestrator = this.orchestratorSvc.orchestrator;

    const [blendPools, aquaPools, blendPositions] = await Promise.all([
      orchestrator
        .getPoolsByType("blend", POOL_CATALOG_LIMITS.blend)
        .catch((e: Error) => {
          this.logger.warn(`[dashboard] blend pools failed: ${e.message}`);
          return [] as PoolInfo[];
        }),
      orchestrator
        .getPoolsByType("aqua", POOL_CATALOG_LIMITS.aqua)
        .catch((e: Error) => {
          this.logger.warn(`[dashboard] aqua pools failed: ${e.message}`);
          return [] as PoolInfo[];
        }),
      orchestrator.getAllBlendUserPositions(wallet).catch((e: Error) => {
        this.logger.warn(`[dashboard] blend positions failed: ${e.message}`);
        return [] as PoolPosition[];
      }),
    ]);

    const nonBlendPools = aquaPools;
    const lpPoolIds =
      nonBlendPools.length > 0
        ? await batchCheckLpBalances(this.stellar.rpc, nonBlendPools, wallet)
        : new Set<string>();
    const candidatePools = nonBlendPools.filter((p) => lpPoolIds.has(p.id));

    const nonBlendPositions = await Promise.allSettled(
      candidatePools.map(async (pool) => ({
        pool,
        position: await orchestrator.getUserPosition(pool.id, wallet),
      }))
    );

    const blendEntries: DashboardPoolPositionEntry[] = blendPositions
      .filter((pos) => {
        const hasDeposit = pos.deposited > 0n;
        const liabilities = Number(pos.metadata?.liabilities ?? 0);
        if (!hasDeposit && !(liabilities > 0)) return false;
        const parts = pos.poolId.split(":");
        const assetAddress = parts[2];
        return !assetAddress || !BLEND_VAULT_ONLY_RESERVES.has(assetAddress);
      })
      .map((pos) => {
        const pool = blendPools.find((p) => p.id === pos.poolId);
        return pool ? { pool, position: pos } : null;
      })
      .filter(
        (entry): entry is { pool: PoolInfo; position: PoolPosition } =>
          entry !== null
      )
      .map((entry) => ({
        pool: serializePool(entry.pool),
        position: serializePosition(entry.position),
      }));

    const nonBlendEntries: DashboardPoolPositionEntry[] = [];
    for (const settled of nonBlendPositions) {
      if (settled.status !== "fulfilled") continue;
      const { pool, position } = settled.value;
      const hasDeposit = position.deposited > 0n;
      const liabilities = Number(position.metadata?.liabilities ?? 0);
      if (!hasDeposit && !(liabilities > 0)) continue;
      nonBlendEntries.push({
        pool: serializePool(pool),
        position: serializePosition(position),
      });
    }

    return [...blendEntries, ...nonBlendEntries];
  }

  // Vault stats (TVL + pricePerShare) are global — not per-wallet — so they get
  // their own 5-min cache shared across all position requests.
  private getVaultStats(): Promise<Map<string, bigint>> {
    return this.cache.getOrFetch("vault-stats", 5 * 60_000, () =>
      this.loadVaultStats()
    );
  }

  private async loadVaultStats(): Promise<Map<string, bigint>> {
    const vaultIds = parseAllVaultIds();
    const rpcUrl = this.config.getOrThrow<string>("STELLAR_RPC_URL");
    const passphrase = this.stellar.getNetworkPassphrase();
    const allowHttp = rpcUrl.startsWith("http://");

    const settled = await Promise.allSettled(
      vaultIds.map(async (vaultId) => {
        const client = new DefindexVaultClient({
          contractId: vaultId,
          rpcUrl,
          networkPassphrase: passphrase,
          ...(allowHttp ? { allowHttp: true } : {}),
        });
        const [totalManagedTx, totalSupplyTx] = await Promise.all([
          throttledRpc(() =>
            client.fetch_total_managed_funds({ simulate: true })
          ),
          throttledRpc(() => client.total_supply({ simulate: true })),
        ]);
        const allocations = unwrapResult<Array<{ total_amount: bigint }>>(
          totalManagedTx.result,
          []
        );
        const tvl =
          allocations.length > 0
            ? BigInt(allocations[0].total_amount.toString())
            : 0n;
        const totalShares = BigInt(totalSupplyTx.result?.toString() ?? "0");
        const pricePerShare =
          totalShares > 0n ? (tvl * ONE_SHARE) / totalShares : 0n;
        return { vaultId, pricePerShare };
      })
    );

    const map = new Map<string, bigint>();
    for (const result of settled) {
      if (result.status === "fulfilled") {
        map.set(result.value.vaultId, result.value.pricePerShare);
      }
    }
    return map;
  }

  private async loadVaultPositions(
    wallet: string
  ): Promise<DashboardVaultPosition[]> {
    const vaultIds = parseAllVaultIds();
    if (vaultIds.length === 0) return [];

    const rpcUrl = this.config.getOrThrow<string>("STELLAR_RPC_URL");
    const passphrase = this.stellar.getNetworkPassphrase();
    const allowHttp = rpcUrl.startsWith("http://");

    // Vault stats and balances fetched in parallel — stats are cached 5min globally.
    const [vaultStats, settled] = await Promise.all([
      this.getVaultStats(),
      Promise.allSettled(
        vaultIds.map(async (vaultId) => {
          const client = new DefindexVaultClient({
            contractId: vaultId,
            rpcUrl,
            networkPassphrase: passphrase,
            ...(allowHttp ? { allowHttp: true } : {}),
          });
          const balanceTx = await throttledRpc(() =>
            client.balance({ id: wallet }, { simulate: true })
          );
          const shares = BigInt(balanceTx.result?.toString() ?? "0");
          return { vaultId, userShares: shares };
        })
      ),
    ]);

    const positions: DashboardVaultPosition[] = [];
    for (const result of settled) {
      if (result.status !== "fulfilled") {
        this.logger.debug(
          `[dashboard] vault balance failed: ${(result.reason as Error)?.message ?? result.reason}`
        );
        continue;
      }
      const { vaultId, userShares } = result.value;
      if (userShares > 0n) {
        positions.push({
          vaultId,
          userShares: userShares.toString(),
          pricePerShare: (vaultStats.get(vaultId) ?? 0n).toString(),
        });
      }
    }
    return positions;
  }
}
