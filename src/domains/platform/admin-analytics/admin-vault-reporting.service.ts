import { Injectable, Logger } from "@nestjs/common";
import type {
  AuditActionType,
  VaultDepositor,
  VaultDepositorsGroup,
  WalletVaultPosition,
} from "@neko-protocol/api-contracts";
import { SupabaseService } from "@core/supabase/supabase.service";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";
import { DefindexService } from "@domains/investing/defindex/defindex.service";
import { DashboardService } from "@domains/platform/dashboard/dashboard.service";

interface RawManagedFund {
  asset?: string;
  total_amount?: string | number;
}

interface RawVaultAsset {
  symbol?: string;
  name?: string;
  address?: string;
}

type DefindexVault = { contractId: string; info: unknown };

// Matches DashboardService's own share-precision constant — pricePerShare is
// scaled by this factor, so it must cancel out the same way here.
const ONE_SHARE = 1_000_000_000_000n;

// Stellar/Soroban asset amounts are fixed-point with 7 decimal places.
const ASSET_DECIMALS_SCALE = 1e7;

const VAULTS_DEPOSIT: AuditActionType = "vaults_deposit";

const VAULT_DEPOSITORS_CACHE_TTL_MS = 2 * 60_000;
const VAULT_BALANCE_BATCH_SIZE = 8;
const VAULT_BALANCE_BATCH_GAP_MS = 150;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Vault-specific reporting: TVL, per-wallet vault positions, and per-vault
 * depositor breakdowns. Kept separate from `AdminStatsService` (platform-wide
 * user/volume stats) since this half owns all the on-chain balance/pricing
 * math, while that half is pure Supabase aggregation.
 */
@Injectable()
export class AdminVaultReportingService {
  private readonly logger = new Logger(AdminVaultReportingService.name);

  private vaultDepositorsCache: {
    data: VaultDepositorsGroup[];
    ts: number;
  } | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly defindex: DefindexService,
    private readonly dashboard: DashboardService,
    private readonly stellar: StellarRpcService
  ) {}

  private extractAsset(
    vault: DefindexVault | undefined
  ): RawVaultAsset | undefined {
    return ((vault?.info as { assets?: RawVaultAsset[] } | undefined)?.assets ??
      [])[0];
  }

  /**
   * Converts a raw (shares, pricePerShare) pair — both scaled the same way
   * `DashboardService` scales them — into a token amount and its USD value.
   * Shared by `getWalletVaultPositions` and `getVaultDepositors` so the
   * conversion formula lives in exactly one place.
   */
  private sharesToBalance(
    shares: bigint,
    pricePerShare: bigint,
    priceUsd: number
  ): { tokens: number; usd: number } | null {
    if (shares <= 0n || pricePerShare <= 0n) return null;
    const rawBalance = (shares * pricePerShare) / ONE_SHARE;
    const tokens = Number(rawBalance) / ASSET_DECIMALS_SCALE;
    return { tokens, usd: tokens * priceUsd };
  }

  // Circle's official USDC issuer on Stellar mainnet — matches the same
  // issuer used as the underlying asset for the USDC DeFindex vault.
  private static readonly USDC_ISSUER =
    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

  /**
   * The Neko admin/treasury wallet only ever holds operating funds — native
   * XLM (for fees) and plain Circle-USDC — not DeFindex vault shares, so this
   * intentionally does not compute vault positions (see `getVaultDepositors`
   * for per-vault, per-depositor reporting instead).
   */
  async getWalletVaultPositions(
    wallet: string
  ): Promise<WalletVaultPosition[]> {
    try {
      const account = await this.stellar.horizon.loadAccount(wallet);
      const { prices } = await this.dashboard.getPrices(["XLM", "USDC"]);
      const positions: WalletVaultPosition[] = [];

      const native = account.balances.find((b) => b.asset_type === "native") as
        | { balance: string }
        | undefined;
      if (native) {
        const amountTokens = Number(native.balance);
        positions.push({
          vaultId: "native-xlm",
          symbol: "XLM",
          name: "XLM",
          amountTokens,
          balanceUsd: amountTokens * (prices.XLM?.price ?? 0),
        });
      }

      const usdc = account.balances.find(
        (b) =>
          "asset_code" in b &&
          b.asset_code === "USDC" &&
          "asset_issuer" in b &&
          b.asset_issuer === AdminVaultReportingService.USDC_ISSUER
      ) as { balance: string } | undefined;
      if (usdc) {
        const amountTokens = Number(usdc.balance);
        positions.push({
          vaultId: "native-usdc",
          symbol: "USDC",
          name: "USDC",
          amountTokens,
          balanceUsd: amountTokens * (prices.USDC?.price ?? 0),
        });
      }

      return positions;
    } catch (err) {
      this.logger.warn(
        `[admin-vault-reporting] native balance fetch failed: ${String(err)}`
      );
      return [];
    }
  }

  async getVaultsTvlUsd(): Promise<number> {
    try {
      const { vaults, prices } = await this.defindex.getVaults();
      let sum = 0;
      for (const { info } of vaults) {
        const funds = (info as { totalManagedFunds?: unknown })
          .totalManagedFunds;
        if (!Array.isArray(funds)) continue;
        for (const raw of funds as RawManagedFund[]) {
          const tokens = Number(raw.total_amount ?? 0) / ASSET_DECIMALS_SCALE;
          if (!Number.isFinite(tokens)) continue;
          const price = raw.asset ? (prices[raw.asset] ?? 0) : 0;
          sum += tokens * price;
        }
      }
      return sum;
    } catch (err) {
      this.logger.warn(
        `[admin-vault-reporting] TVL computation failed: ${String(err)}`
      );
      return 0;
    }
  }

  async getVaultDepositors(): Promise<VaultDepositorsGroup[]> {
    if (
      this.vaultDepositorsCache &&
      Date.now() - this.vaultDepositorsCache.ts < VAULT_DEPOSITORS_CACHE_TTL_MS
    ) {
      return this.vaultDepositorsCache.data;
    }

    const [{ data: depositRows }, { vaults, prices }] = await Promise.all([
      this.supabase.client
        .from("audit_logs")
        .select("wallet_address")
        .eq("network", "mainnet")
        .eq("action_type", VAULTS_DEPOSIT),
      this.defindex.getVaults(),
    ]);

    const wallets = Array.from(
      new Set(
        (depositRows ?? [])
          .map((r: { wallet_address: string | null }) => r.wallet_address)
          .filter((w): w is string => Boolean(w))
      )
    );

    const emailByWallet = new Map<string, string>();
    if (wallets.length > 0) {
      const { data: userRows } = await this.supabase.client
        .from("users")
        .select("wallet_address, email")
        .in("wallet_address", wallets);
      for (const u of userRows ?? []) {
        if (u.email) emailByWallet.set(u.wallet_address, u.email);
      }
    }

    const groups = new Map<
      string,
      { symbol: string; depositors: VaultDepositor[] }
    >();
    for (const vault of vaults) {
      const asset = this.extractAsset(vault);
      groups.set(vault.contractId, {
        symbol: asset?.symbol ?? "?",
        depositors: [],
      });
    }

    // Vault balances require one on-chain RPC call per wallet — batch with a
    // small gap so we don't overwhelm the RPC endpoint for larger wallet sets.
    for (let i = 0; i < wallets.length; i += VAULT_BALANCE_BATCH_SIZE) {
      const batch = wallets.slice(i, i + VAULT_BALANCE_BATCH_SIZE);
      const settled = await Promise.allSettled(
        batch.map((wallet) => this.dashboard.getVaultPositions(wallet))
      );

      settled.forEach((result, idx) => {
        if (result.status !== "fulfilled") return;
        const wallet = batch[idx];
        for (const position of result.value) {
          const group = groups.get(position.vaultId);
          const vault = vaults.find((v) => v.contractId === position.vaultId);
          const asset = this.extractAsset(vault);
          if (!group || !asset?.address) continue;

          const balance = this.sharesToBalance(
            BigInt(position.userShares || "0"),
            BigInt(position.pricePerShare || "0"),
            prices[asset.address] ?? 0
          );
          if (!balance) continue;

          group.depositors.push({
            wallet,
            email: emailByWallet.get(wallet) ?? null,
            amountTokens: balance.tokens,
            balanceUsd: balance.usd,
          });
        }
      });

      if (i + VAULT_BALANCE_BATCH_SIZE < wallets.length) {
        await delay(VAULT_BALANCE_BATCH_GAP_MS);
      }
    }

    const data = Array.from(groups.entries()).map(([vaultId, group]) => ({
      vaultId,
      symbol: group.symbol,
      depositors: group.depositors.sort((a, b) => b.balanceUsd - a.balanceUsd),
    }));

    this.vaultDepositorsCache = { data, ts: Date.now() };
    return data;
  }
}
