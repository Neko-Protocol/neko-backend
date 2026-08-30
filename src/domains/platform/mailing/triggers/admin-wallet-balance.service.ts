import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Keypair } from "@stellar/stellar-sdk";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";

/**
 * Reads the native XLM balance of the wallet that funds keeper operations.
 *
 * The address is taken from ADMIN_WALLET_ADDRESS when set, and otherwise
 * derived from VAULT_MANAGER_SECRET_KEY, which is the account that actually
 * pays for vault invest and APY runs and so is the one that runs dry.
 */
@Injectable()
export class AdminWalletBalanceService {
  private readonly logger = new Logger(AdminWalletBalanceService.name);
  private cachedAddress: string | null | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly stellar: StellarRpcService
  ) {}

  get address(): string | null {
    if (this.cachedAddress !== undefined) return this.cachedAddress;

    const explicit = this.config.get<string>("ADMIN_WALLET_ADDRESS")?.trim();
    if (explicit) {
      this.cachedAddress = explicit;
      return explicit;
    }

    const secret = this.config.get<string>("VAULT_MANAGER_SECRET_KEY")?.trim();
    if (!secret) {
      this.cachedAddress = null;
      return null;
    }
    try {
      this.cachedAddress = Keypair.fromSecret(secret).publicKey();
    } catch {
      this.logger.warn(
        "VAULT_MANAGER_SECRET_KEY is not a valid secret; admin wallet balance checks are disabled"
      );
      this.cachedAddress = null;
    }
    return this.cachedAddress;
  }

  /** Native XLM balance, or null when it can't be determined. */
  async getXlmBalance(): Promise<number | null> {
    const address = this.address;
    if (!address) return null;

    try {
      const account = await this.stellar.horizon.loadAccount(address);
      const native = account.balances.find(
        (b: { asset_type: string }) => b.asset_type === "native"
      ) as { balance?: string } | undefined;
      if (!native?.balance) return null;

      const balance = Number(native.balance);
      return Number.isFinite(balance) ? balance : null;
    } catch (err) {
      this.logger.warn(
        `admin wallet balance lookup failed: ${(err as Error).message}`
      );
      return null;
    }
  }
}
