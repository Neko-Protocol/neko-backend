jest.mock("@neko/defindex-vault", () => ({
  Client: jest.fn(),
}));

jest.mock("@neko/keeper", () => ({
  parseAllVaultIds: jest.fn(),
}));

jest.mock("@neko/orchestrator", () => ({
  BLEND_VAULT_ONLY_RESERVES: new Set<string>(),
  throttledRpc: <T>(fn: () => Promise<T>) => fn(),
}));

jest.mock("./lp-screen", () => ({
  batchCheckLpBalances: jest.fn(),
}));

import { ConfigService } from "@nestjs/config";
import { Client as DefindexVaultClient } from "@neko/defindex-vault";
import { parseAllVaultIds } from "@neko/keeper";
import { DashboardCache } from "./cache/dashboard-cache";
import { DashboardService } from "./dashboard.service";
import { batchCheckLpBalances } from "./lp-screen";

const ClientMock = DefindexVaultClient as unknown as jest.Mock;
const parseAllVaultIdsMock = parseAllVaultIds as unknown as jest.Mock;
const batchCheckLpBalancesMock = batchCheckLpBalances as unknown as jest.Mock;

const WALLET_A = "GA000000000000000000000000000000000000000000000000000000A";

function makeOrchestrator() {
  return {
    getPoolsByType: jest.fn(),
    getAllBlendUserPositions: jest.fn(),
    getUserPosition: jest.fn(),
  };
}

function build({
  orchestrator,
  priceService,
  config,
}: {
  orchestrator: ReturnType<typeof makeOrchestrator>;
  priceService?: { getPriceWithSource: jest.Mock };
  config?: Partial<Record<string, string>>;
}) {
  const cache = new DashboardCache();
  const stellar = {
    rpc: { __mock: "rpc.Server" },
    getNetworkPassphrase: () => "Test SDF Network ; September 2015",
  } as never;
  const orchestratorSvc = { orchestrator } as never;
  const configSvc = {
    getOrThrow: jest.fn((key: string) => {
      const value = config?.[key];
      if (value === undefined) throw new Error(`missing ${key}`);
      return value;
    }),
  } as unknown as ConfigService;
  const prices = priceService ?? {
    getPriceWithSource: jest
      .fn()
      .mockResolvedValue({ price: 0, source: "unknown" }),
  };
  const svc = new DashboardService(
    orchestratorSvc,
    stellar,
    cache,
    configSvc,
    prices as never
  );
  return { svc, cache, prices };
}

describe("DashboardService", () => {
  beforeEach(() => {
    ClientMock.mockReset();
    parseAllVaultIdsMock.mockReset();
    batchCheckLpBalancesMock.mockReset();
    batchCheckLpBalancesMock.mockResolvedValue(new Set<string>());
    parseAllVaultIdsMock.mockReturnValue([]);
  });

  describe("getPoolCatalog", () => {
    it("returns serialized pools per protocol and caches the result", async () => {
      const blendPool = {
        id: "blend:1",
        type: "blend" as const,
        name: "Blend Pool",
        tokens: [],
        tvl: 100n,
        apy: 5,
        state: "active" as const,
        supportedActions: [],
        metadata: {},
      };
      const orchestrator = makeOrchestrator();
      orchestrator.getPoolsByType.mockImplementation((type: string) => {
        if (type === "blend") return Promise.resolve([blendPool]);
        return Promise.resolve([]);
      });
      const { svc } = build({ orchestrator });

      const first = await svc.getPoolCatalog();
      const second = await svc.getPoolCatalog();

      expect(first.blend).toHaveLength(1);
      expect(first.blend[0].tvl).toBe("100");
      expect(first.aqua).toEqual([]);
      expect(orchestrator.getPoolsByType).toHaveBeenCalledTimes(3); // first call only
      expect(second).toEqual(first);
    });
  });

  describe("getPositions", () => {
    it("returns blend + non-blend positions, filters empty ones, serializes bigints", async () => {
      const blendPool = {
        id: "blend:1",
        type: "blend" as const,
        name: "Blend Pool",
        tokens: [],
        tvl: 0n,
        apy: 0,
        state: "active" as const,
        supportedActions: [],
        metadata: {},
      };
      const aquaPool = {
        id: "aqua:1",
        type: "aqua" as const,
        name: "Aqua Pool",
        tokens: [],
        tvl: 0n,
        apy: 0,
        state: "active" as const,
        supportedActions: [],
        metadata: { shareTokenAddress: "CSHARE" },
      };
      const blendPos = {
        poolId: "blend:1",
        deposited: 500n,
        depositedFormatted: "0.0005",
        rewards: 0n,
        rewardsFormatted: "0",
        metadata: {},
      };
      const emptyBlendPos = {
        poolId: "blend:absent",
        deposited: 0n,
        depositedFormatted: "0",
        rewards: 0n,
        rewardsFormatted: "0",
        metadata: {},
      };
      const aquaPos = {
        poolId: "aqua:1",
        deposited: 10n,
        depositedFormatted: "0.0000010",
        rewards: 0n,
        rewardsFormatted: "0",
        metadata: {},
      };

      const orchestrator = makeOrchestrator();
      orchestrator.getPoolsByType.mockImplementation((type: string) => {
        if (type === "blend") return Promise.resolve([blendPool]);
        if (type === "aqua") return Promise.resolve([aquaPool]);
        return Promise.resolve([]);
      });
      orchestrator.getAllBlendUserPositions.mockResolvedValue([
        blendPos,
        emptyBlendPos,
      ]);
      orchestrator.getUserPosition.mockResolvedValue(aquaPos);
      batchCheckLpBalancesMock.mockResolvedValue(new Set(["aqua:1"]));
      parseAllVaultIdsMock.mockReturnValue([]);

      const { svc } = build({
        orchestrator,
        config: {
          STELLAR_RPC_URL: "https://rpc.example",
        },
      });
      const out = await svc.getPositions(WALLET_A);

      expect(out.poolPositions).toHaveLength(2);
      const ids = out.poolPositions.map((e) => e.position.poolId);
      expect(ids).toContain("blend:1");
      expect(ids).toContain("aqua:1");
      const blendEntry = out.poolPositions.find(
        (e) => e.position.poolId === "blend:1"
      )!;
      expect(blendEntry.position.deposited).toBe("500");
      expect(out.vaultPositions).toEqual([]);
    });

    it("dedups concurrent requests and caches", async () => {
      const orchestrator = makeOrchestrator();
      orchestrator.getPoolsByType.mockResolvedValue([]);
      orchestrator.getAllBlendUserPositions.mockResolvedValue([]);
      parseAllVaultIdsMock.mockReturnValue([]);

      const { svc } = build({
        orchestrator,
        config: { STELLAR_RPC_URL: "https://rpc.example" },
      });

      const [a, b] = await Promise.all([
        svc.getPositions(WALLET_A),
        svc.getPositions(WALLET_A),
      ]);
      const c = await svc.getPositions(WALLET_A);

      expect(a).toEqual(b);
      expect(c).toEqual(a);
      // getPoolsByType called once per type on the single fetch
      expect(orchestrator.getPoolsByType).toHaveBeenCalledTimes(3);
      expect(orchestrator.getAllBlendUserPositions).toHaveBeenCalledTimes(1);
    });

    it("includes vault positions when shares are non-zero", async () => {
      const orchestrator = makeOrchestrator();
      orchestrator.getPoolsByType.mockResolvedValue([]);
      orchestrator.getAllBlendUserPositions.mockResolvedValue([]);
      parseAllVaultIdsMock.mockReturnValue(["VAULT_A", "VAULT_B"]);

      const balanceA = jest
        .fn()
        .mockResolvedValue({ result: { toString: () => "42" } });
      const balanceB = jest
        .fn()
        .mockResolvedValue({ result: { toString: () => "0" } });
      // Stats clients come first (loadVaultStats runs in parallel with balance queries).
      // pricePerShare_A = (1_000_000_000 * 1_000_000_000_000) / 500 = 2_000_000_000_000_000_000
      const totalManagedA = jest
        .fn()
        .mockResolvedValue({ result: [{ total_amount: 1_000_000_000n }] });
      const totalSupplyA = jest
        .fn()
        .mockResolvedValue({ result: { toString: () => "500" } });
      const totalManagedB = jest.fn().mockResolvedValue({ result: [] });
      const totalSupplyB = jest
        .fn()
        .mockResolvedValue({ result: { toString: () => "0" } });
      // Instantiation order: stats client A, stats client B, balance client A, balance client B
      ClientMock.mockImplementationOnce(() => ({
        fetch_total_managed_funds: totalManagedA,
        total_supply: totalSupplyA,
      }));
      ClientMock.mockImplementationOnce(() => ({
        fetch_total_managed_funds: totalManagedB,
        total_supply: totalSupplyB,
      }));
      ClientMock.mockImplementationOnce(() => ({ balance: balanceA }));
      ClientMock.mockImplementationOnce(() => ({ balance: balanceB }));

      const { svc } = build({
        orchestrator,
        config: { STELLAR_RPC_URL: "https://rpc.example" },
      });
      const out = await svc.getPositions(WALLET_A);

      expect(out.vaultPositions).toEqual([
        {
          vaultId: "VAULT_A",
          userShares: "42",
          pricePerShare: "2000000000000000000",
        },
      ]);
      expect(balanceA).toHaveBeenCalledWith(
        { id: WALLET_A },
        { simulate: true }
      );
    });
  });

  describe("getPrices", () => {
    it("returns an empty result when no symbols provided", async () => {
      const orchestrator = makeOrchestrator();
      const { svc, prices } = build({ orchestrator });
      const result = await svc.getPrices([]);
      expect(result.prices).toEqual({});
      expect(prices.getPriceWithSource).not.toHaveBeenCalled();
    });

    it("queries the price service once per symbol and caches per symbol", async () => {
      const orchestrator = makeOrchestrator();
      const priceService = {
        getPriceWithSource: jest.fn().mockImplementation((symbol: string) =>
          Promise.resolve({
            price: symbol === "XLM" ? 0.1 : 1,
            source: "reflector",
          })
        ),
      };
      const { svc } = build({ orchestrator, priceService });

      const first = await svc.getPrices(["XLM", "USDC"]);
      const second = await svc.getPrices(["USDC", "XLM"]);

      expect(first.prices).toEqual({
        XLM: { price: 0.1, source: "reflector" },
        USDC: { price: 1, source: "reflector" },
      });
      expect(second.prices).toEqual(first.prices);
      // Two cache misses on first call, then both hits on second.
      expect(priceService.getPriceWithSource).toHaveBeenCalledTimes(2);
    });

    it("swallows per-symbol price failures", async () => {
      const orchestrator = makeOrchestrator();
      const priceService = {
        getPriceWithSource: jest.fn((symbol: string) =>
          symbol === "BAD"
            ? Promise.reject(new Error("boom"))
            : Promise.resolve({ price: 2, source: "soroswap" })
        ),
      };
      const { svc } = build({ orchestrator, priceService });
      const result = await svc.getPrices(["BAD", "OK"]);
      expect(result.prices).toEqual({
        OK: { price: 2, source: "soroswap" },
      });
    });
  });
});
