// AdminStatsService's AdminVaultReportingService param transitively imports
// DefindexService/DashboardService, which pull in
// @neko-protocol/keeper/@neko-protocol/orchestrator/@neko-protocol/defindex-vault (ESM workspace
// packages Jest's CJS loader can't parse) — stub the named exports touched.
jest.mock("@neko-protocol/keeper", () => ({
  createDefindexServerSdk: jest.fn(),
  defindexNetworkFromString: jest.fn(),
  getAssetsConfig: jest.fn().mockReturnValue({}),
  getCurrentNetworkId: jest.fn().mockReturnValue("mainnet"),
  parseDefindexVaultIds: jest.fn().mockReturnValue([]),
  parseAllVaultIds: jest.fn().mockReturnValue([]),
}));
jest.mock("@neko-protocol/orchestrator", () => ({
  BLEND_VAULT_ONLY_RESERVES: new Set(),
  throttledRpc: (fn: () => unknown) => fn(),
}));
jest.mock("@neko-protocol/defindex-vault", () => ({ Client: jest.fn() }));

import { AdminStatsService } from "./admin-stats.service";
import type { AdminVaultReportingService } from "./admin-vault-reporting.service";
import type { SupabaseService } from "@core/supabase/supabase.service";

/**
 * Minimal thenable Supabase query-builder stub: every chain method
 * (select/eq/in/not/order/range/gte/lte) returns itself, and awaiting the
 * builder resolves to whatever `result` was configured for it.
 */
function chainable(result: unknown) {
  const builder: Record<string, unknown> = {};
  const methods = [
    "select",
    "eq",
    "in",
    "not",
    "order",
    "range",
    "gte",
    "lte",
    "limit",
  ];
  for (const m of methods) {
    builder[m] = jest.fn().mockReturnValue(builder);
  }
  builder.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return builder;
}

function makeService(fromMock: jest.Mock, tvlUsd = 0) {
  const supabase = {
    client: { from: fromMock },
  } as unknown as SupabaseService;
  const vaultReporting = {
    getVaultsTvlUsd: jest.fn().mockResolvedValue(tvlUsd),
  } as unknown as AdminVaultReportingService;

  // Instantiated directly (no NestJS DI) — see admin-vault-reporting.service.spec.ts
  // for why: importing the real service classes for DI tokens would pull in
  // @neko-protocol/keeper's ESM build, which Jest's CJS transform can't parse.
  return new AdminStatsService(supabase, vaultReporting);
}

describe("AdminStatsService", () => {
  describe("getUserStats", () => {
    it("counts invested (>=1 deposit) and re-invested (>=2 deposits) wallets, deduped per wallet", async () => {
      const fromMock = jest
        .fn()
        .mockReturnValueOnce(chainable({ count: 10 })) // totalUsers
        .mockReturnValueOnce(chainable({ count: 5 })) // emailConfirmed
        .mockReturnValueOnce(
          chainable({
            data: [
              { wallet_address: "A" }, // 1 deposit -> invested only
              { wallet_address: "B" },
              { wallet_address: "B" }, // 2 deposits -> invested + re-invested
              { wallet_address: "C" },
              { wallet_address: "C" },
              { wallet_address: "C" }, // 3 deposits -> still counts once for re-invested
            ],
          })
        );

      const service = makeService(fromMock);
      const stats = await service.getUserStats();

      expect(stats.totalUsers).toBe(10);
      expect(stats.emailConfirmed).toBe(5);
      expect(stats.emailConfirmedPct).toBeCloseTo(0.5);
      expect(stats.investedCount).toBe(3);
      expect(stats.reinvestedCount).toBe(2);
      expect(stats.investedPct).toBeCloseTo(0.3);
      expect(stats.reinvestedPct).toBeCloseTo(0.2);
    });

    it("returns zero percentages instead of dividing by zero when there are no users", async () => {
      const fromMock = jest
        .fn()
        .mockReturnValueOnce(chainable({ count: 0 }))
        .mockReturnValueOnce(chainable({ count: 0 }))
        .mockReturnValueOnce(chainable({ data: [] }));

      const service = makeService(fromMock);
      const stats = await service.getUserStats();

      expect(stats.investedPct).toBe(0);
      expect(stats.reinvestedPct).toBe(0);
      expect(stats.emailConfirmedPct).toBe(0);
    });
  });

  describe("getOverview", () => {
    it("sums one side (amount_in, falling back to amount_out) per row — no double-counting", async () => {
      const fromMock = jest
        .fn()
        .mockReturnValueOnce(
          chainable({
            data: [
              { amount_in: 100, amount_out: null },
              { amount_in: null, amount_out: 50 },
            ],
          })
        ) // deposits + swaps volume = 150
        .mockReturnValueOnce(chainable({ count: 7 })) // swaps count
        .mockReturnValueOnce(
          chainable({ data: [{ amount_in: 50, amount_out: null }] })
        ); // swap-only volume = 50

      const service = makeService(fromMock, 1234);
      const overview = await service.getOverview();

      expect(overview.tvlUsd).toBe(1234);
      expect(overview.volumeUsd).toBe(150);
      expect(overview.swapsCount).toBe(7);
      expect(overview.swapsVolumeUsd).toBe(50);
    });
  });
});
