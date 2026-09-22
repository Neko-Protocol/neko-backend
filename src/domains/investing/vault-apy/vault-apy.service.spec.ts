import { ConfigService } from "@nestjs/config";
import { RedisCacheService } from "@core/cache/redis-cache.service";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";
import { VaultApyService, type VaultApyResult } from "./vault-apy.service";

const VAULT = "CB3FUMFGCF6DHSFK6N2TOKHRMYXS34HFKQR45UKVORCRUM35AF3ES7WQ";

// @neko-protocol/keeper and @neko-protocol/orchestrator ship ESM-only dists, so they cannot be
// required from these CJS specs. Nothing here needs the real thing: vault
// resolution is the only part this suite exercises, and the computation that
// would use the rest is stubbed out.
jest.mock("@neko-protocol/keeper", () => ({
  resolveVaultIdForApi: (requested: string | null) => requested,
  createDefindexServerSdk: jest.fn(),
  defindexNetworkFromString: jest.fn(),
}));

jest.mock("@neko-protocol/orchestrator", () => ({
  computeBlendEmissionsApy: jest.fn(),
  getBlendNetwork: jest.fn(),
  getBlndPriceUsd: jest.fn(),
}));

/**
 * Stands in for Redis with the same contract `through` offers: serve a stored
 * value, otherwise run the producer once and store what it returns.
 */
function fakeCache() {
  const store = new Map<string, unknown>();
  const invalidated: string[] = [];
  return {
    store,
    invalidated,
    through: jest.fn(
      async <T>(key: string, _ttl: number, fetch: () => Promise<T>) => {
        if (store.has(key)) return { value: store.get(key) as T, hit: true };
        const value = await fetch();
        store.set(key, value);
        return { value, hit: false };
      }
    ),
    invalidate: jest.fn(async (key: string) => {
      invalidated.push(key);
      store.delete(key);
    }),
  };
}

function build(cache: ReturnType<typeof fakeCache>) {
  const config = {
    get: (k: string) => (k === "STELLAR_NETWORK" ? "mainnet" : undefined),
  } as unknown as ConfigService;
  return new VaultApyService(
    config,
    {} as StellarRpcService,
    cache as unknown as RedisCacheService
  );
}

function stubCompute(service: VaultApyService, result: VaultApyResult) {
  return jest
    .spyOn(
      service as unknown as { computeVaultApy: () => Promise<VaultApyResult> },
      "computeVaultApy"
    )
    .mockResolvedValue(result);
}

describe("VaultApyService caching", () => {
  it("computes once and serves the repeat from cache", async () => {
    const cache = fakeCache();
    const service = build(cache);
    const compute = stubCompute(service, { vaultApy: 4.56, strategies: [] });

    await service.getVaultApy(VAULT);
    const second = await service.getVaultApy(VAULT);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(second.vaultApy).toBe(4.56);
  });

  it("keys per vault, so one vault's answer is not served for another", async () => {
    const cache = fakeCache();
    const service = build(cache);
    const compute = stubCompute(service, { vaultApy: 4.56, strategies: [] });

    await service.getVaultApy(VAULT);
    await service.getVaultApy(
      "CCUZC3HC5TH2VCYZFUG57E6IGKPL45YUN2SI3UEYQUBA7RCYHUIZBSFV"
    );

    expect(compute).toHaveBeenCalledTimes(2);
  });

  // A null APY is normally an upstream outage, not a vault earning nothing.
  // Pinning it would leave a dash on the dashboard for the whole window.
  it("does not keep a null APY, so the next caller retries", async () => {
    const cache = fakeCache();
    const service = build(cache);
    stubCompute(service, { vaultApy: null, strategies: [] });

    const result = await service.getVaultApy(VAULT);

    expect(result.vaultApy).toBeNull();
    expect(cache.invalidated).toEqual([`vault-apy:mainnet:${VAULT}`]);
    expect(cache.store.size).toBe(0);
  });

  it("keeps a real APY", async () => {
    const cache = fakeCache();
    const service = build(cache);
    stubCompute(service, { vaultApy: 4.56, strategies: [] });

    await service.getVaultApy(VAULT);

    expect(cache.invalidate).not.toHaveBeenCalled();
    expect(cache.store.size).toBe(1);
  });

  it("answers an unknown vault without touching the cache", async () => {
    const cache = fakeCache();
    const service = build(cache);
    const compute = stubCompute(service, { vaultApy: 4.56, strategies: [] });

    const result = await service.getVaultApy(null);

    expect(result.note).toMatch(/No vault configured/);
    expect(compute).not.toHaveBeenCalled();
    expect(cache.through).not.toHaveBeenCalled();
  });
});
