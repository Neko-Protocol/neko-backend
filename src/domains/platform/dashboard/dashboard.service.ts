import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  BLEND_VAULT_ONLY_RESERVES,
  throttledRpc,
  type PoolInfo,
  type PoolPosition,
} from "@neko-protocol/orchestrator";
import { parseAllVaultIds, type StellarPriceService } from "@neko-protocol/keeper";
import { Client as DefindexVaultClient } from "@neko-protocol/defindex-vault";
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

/**
 * Two minutes, not thirty seconds.
 *
 * The dashboard polls this every 60s, so a 30s window guaranteed every poll
 * arrived just after the entry expired — the cache never once served a refresh,
 * only concurrent duplicates. At two minutes every other poll is a hit and the
 * recomputation halves.
 *
 * Safe to hold this long only because a wallet's entry is dropped the moment
 * it submits a transaction (see TransactionService). Without that, a deposit
 * would stay invisible for the whole window.
 */
const TTL_POSITIONS_MS = 120_000;
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

  /**
   * Vault-only positions for a wallet — skips the pool-position lookup
   * (Blend/Aqua catalog + LP balance checks) that `getPositions` also does,
   * which is unnecessary and much slower for callers that only care about
   * vault balances (e.g. admin vault-depositor reporting).
   */
  getVaultPositions(wallet: string): Promise<DashboardVaultPosition[]> {
    return this.cache.getOrFetch(
      `vault-positions:${wallet}`,
      TTL_POSITIONS_MS,
      () => this.loadVaultPositions(wallet)
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

  /**
   * The Blend and Aqua catalogues, cached once for everyone.
   *
   * Which pools exist has nothing to do with who is asking, but the positions
   * lookup used to fetch them itself, inside a cache keyed by wallet. So the
   * catalogue was rebuilt for every wallet — and again 30 seconds later — even
   * though this shared five-minute entry already held it. It is the slowest
   * part of a cold positions call and the part least likely to have changed.
   *
   * Cached in its raw form, bigint `tvl` and all: the codec tags BigInt and
   * rebuilds it, and the position lookups need the pools unserialized.
   */
  private getPools(): Promise<{ blend: PoolInfo[]; aqua: PoolInfo[] }> {
    return this.cache.getOrFetch("pools-raw", TTL_POOL_CATALOG_MS, () =>
      this.loadPools()
    );
  }

  private async loadPools(): Promise<{ blend: PoolInfo[]; aqua: PoolInfo[] }> {
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
    return { blend, aqua };
  }

  private async loadPoolCatalog(): Promise<DashboardPoolCatalogResponse> {
    const { blend, aqua } = await this.getPools();
    return {
      blend: blend.map(serializePool),
      aqua: aqua.map(serializePool),
      fetchedAt: Date.now(),
    };
  }

  private async loadPositions(
    wallet: string
  ): Promise<DashboardPositionsResponse> {
    // Timed per half because this is the slowest endpoint the dashboard calls
    // and the two halves are wildly uneven — without the split the only signal
    // is one number that says "three seconds" and nothing about where.
    const started = Date.now();
    let poolMs = 0;
    let vaultMs = 0;

    const [poolEntries, vaultPositions] = await Promise.all([
      this.loadPoolPositions(wallet).then((r) => {
        poolMs = Date.now() - started;
        return r;
      }),
      // The cached vault-only entry, which the dedicated endpoint also serves.
      // Going through the cache means the vault half is computed once per
      // wallet no matter which of the two endpoints asked for it first.
      this.getVaultPositions(wallet).then((r) => {
        vaultMs = Date.now() - started;
        return r;
      }),
    ]);

    this.logger.debug(
      `[dashboard] positions ${wallet.slice(0, 6)}… pools=${poolMs}ms vaults=${vaultMs}ms`
    );

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
    const startedAt = Date.now();

    // The catalogue comes from the shared cache; only the position lookups are
    // actually about this wallet.
    const poolsPromise = this.getPools();

    // Blend and Aqua are independent: Blend asks the protocol directly, while
    // Aqua needs the catalogue, then an LP screen, then one lookup per pool
    // that survived it. Awaiting both branches together used to stall the Aqua
    // chain behind the Blend call for no reason — the screen only ever needed
    // the catalogue. Started separately, the two run concurrently and the
    // endpoint costs the slower branch instead of their sum.
    const blendBranch = orchestrator
      .getAllBlendUserPositions(wallet)
      .catch((e: Error) => {
        this.logger.warn(`[dashboard] blend positions failed: ${e.message}`);
        return [] as PoolPosition[];
      })
      .then((positions) => {
        this.logger.debug(
          `[dashboard] blend branch ${Date.now() - startedAt}ms`
        );
        return positions;
      });

    const aquaBranch = poolsPromise.then(async ({ aqua }) => {
      const lpPoolIds =
        aqua.length > 0
          ? await batchCheckLpBalances(this.stellar.rpc, aqua, wallet)
          : new Set<string>();
      const candidates = aqua.filter((p) => lpPoolIds.has(p.id));
      const afterScreen = Date.now();

      const settled = await Promise.allSettled(
        candidates.map(async (pool) => ({
          pool,
          position: await orchestrator.getUserPosition(pool.id, wallet),
        }))
      );

      this.logger.debug(
        `[dashboard] aqua branch screen=${afterScreen - startedAt}ms ` +
          `(${candidates.length}/${aqua.length} candidates) ` +
          `positions=${Date.now() - afterScreen}ms`
      );
      return settled;
    });

    const [{ blend: blendPools }, blendPositions, nonBlendPositions] =
      await Promise.all([poolsPromise, blendBranch, aquaBranch]);

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
          // Routed through the pool, so this read gets the same health-aware
          // selection, retry and failover as everything else. `rpcUrl` stays
          // as the fallback the SDK uses only if no server is supplied.
          server: this.stellar.rpc,
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
            server: this.stellar.rpc,
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
