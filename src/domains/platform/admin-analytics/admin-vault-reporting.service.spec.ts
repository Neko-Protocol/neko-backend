// AdminVaultReportingService's constructor params (DefindexService,
// DashboardService) must be real class values for NestJS's DI metadata, and
// those files import @neko/keeper/@neko/orchestrator/@neko/defindex-vault
// (ESM workspace packages Jest's CJS loader can't parse) — stub just the
// named exports touched at import time.
jest.mock("@neko/keeper", () => ({
  createDefindexServerSdk: jest.fn(),
  defindexNetworkFromString: jest.fn(),
  getAssetsConfig: jest.fn().mockReturnValue({}),
  getCurrentNetworkId: jest.fn().mockReturnValue("mainnet"),
  parseDefindexVaultIds: jest.fn().mockReturnValue([]),
  parseAllVaultIds: jest.fn().mockReturnValue([]),
}));
jest.mock("@neko/orchestrator", () => ({
  BLEND_VAULT_ONLY_RESERVES: new Set(),
  throttledRpc: (fn: () => unknown) => fn(),
}));
jest.mock("@neko/defindex-vault", () => ({ Client: jest.fn() }));

import { AdminVaultReportingService } from "./admin-vault-reporting.service";
import type { SupabaseService } from "@core/supabase/supabase.service";
import type { StellarRpcService } from "@core/stellar/stellar-rpc.service";
import type { DefindexService } from "@domains/investing/defindex/defindex.service";
import type { DashboardService } from "@domains/platform/dashboard/dashboard.service";

const ONE_SHARE = 1_000_000_000_000n;
const ASSET_SCALE = 10_000_000n; // Stellar/Soroban 7-decimal fixed point.

const USDC_ADDRESS = "C_USDC_FAKE";
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function makeService(overrides: {
  dashboard?: Record<string, jest.Mock>;
  defindex?: Record<string, jest.Mock>;
  stellar?: unknown;
}) {
  const dashboard = {
    getVaultPositions: jest.fn().mockResolvedValue([]),
    getPrices: jest.fn().mockResolvedValue({ prices: {} }),
    ...overrides.dashboard,
  } as unknown as DashboardService;

  const defindex = {
    getVaults: jest.fn().mockResolvedValue({ vaults: [], prices: {} }),
    ...overrides.defindex,
  } as unknown as DefindexService;

  const stellar = (overrides.stellar ?? {
    horizon: {
      loadAccount: jest.fn().mockRejectedValue(new Error("no account")),
    },
  }) as unknown as StellarRpcService;

  const supabase = {
    client: { from: jest.fn() },
  } as unknown as SupabaseService;

  // Instantiated directly (no NestJS DI container) so this test never has to
  // import the real DefindexService/DashboardService modules — both pull in
  // @neko/keeper's ESM build, which Jest's CJS transform can't parse.
  return new AdminVaultReportingService(supabase, defindex, dashboard, stellar);
}

describe("AdminVaultReportingService", () => {
  describe("getWalletVaultPositions", () => {
    // The Neko admin/treasury wallet only holds operating funds (native XLM
    // + plain Circle-USDC) — this deliberately does NOT compute DeFindex
    // vault share balances (see getVaultDepositors for that).
    it("returns native XLM and Circle-USDC balances, converted to USD", async () => {
      const service = makeService({
        dashboard: {
          getPrices: jest.fn().mockResolvedValue({
            prices: { XLM: { price: 0.2 }, USDC: { price: 1 } },
          }),
        },
        stellar: {
          horizon: {
            loadAccount: jest.fn().mockResolvedValue({
              balances: [
                { asset_type: "native", balance: "100.0000000" },
                {
                  asset_type: "credit_alphanum4",
                  asset_code: "USDC",
                  asset_issuer: USDC_ISSUER,
                  balance: "50.0000000",
                },
              ],
            }),
          },
        },
      });

      const positions = await service.getWalletVaultPositions("GWALLET");

      expect(positions).toEqual([
        {
          vaultId: "native-xlm",
          symbol: "XLM",
          name: "XLM",
          amountTokens: 100,
          balanceUsd: 20,
        },
        {
          vaultId: "native-usdc",
          symbol: "USDC",
          name: "USDC",
          amountTokens: 50,
          balanceUsd: 50,
        },
      ]);
    });

    it("ignores a USDC-code trustline from a different (non-Circle) issuer", async () => {
      const service = makeService({
        dashboard: {
          getPrices: jest.fn().mockResolvedValue({
            prices: { XLM: { price: 0.2 }, USDC: { price: 1 } },
          }),
        },
        stellar: {
          horizon: {
            loadAccount: jest.fn().mockResolvedValue({
              balances: [
                { asset_type: "native", balance: "10.0000000" },
                {
                  asset_type: "credit_alphanum4",
                  asset_code: "USDC",
                  asset_issuer: "GSOME_OTHER_ISSUER",
                  balance: "999.0000000",
                },
              ],
            }),
          },
        },
      });

      const positions = await service.getWalletVaultPositions("GWALLET");

      expect(positions).toEqual([
        {
          vaultId: "native-xlm",
          symbol: "XLM",
          name: "XLM",
          amountTokens: 10,
          balanceUsd: 2,
        },
      ]);
    });

    it("returns an empty list when the account can't be loaded", async () => {
      const service = makeService({
        stellar: {
          horizon: {
            loadAccount: jest.fn().mockRejectedValue(new Error("not found")),
          },
        },
      });

      const positions = await service.getWalletVaultPositions("GMISSING");
      expect(positions).toEqual([]);
    });
  });

  describe("getVaultsTvlUsd", () => {
    it("sums totalManagedFunds across vaults, converted to USD", async () => {
      const service = makeService({
        defindex: {
          getVaults: jest.fn().mockResolvedValue({
            vaults: [
              {
                contractId: "VAULT1",
                info: {
                  totalManagedFunds: [
                    {
                      asset: USDC_ADDRESS,
                      total_amount: (1000n * ASSET_SCALE).toString(),
                    },
                  ],
                },
              },
            ],
            prices: { [USDC_ADDRESS]: 1.5 },
          }),
        },
      });

      const tvl = await service.getVaultsTvlUsd();
      expect(tvl).toBeCloseTo(1500);
    });
  });
});
