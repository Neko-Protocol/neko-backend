import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { StrKey } from "@stellar/stellar-sdk";
import { ErrorCode } from "@neko-protocol/api-contracts";
import { SupabaseService } from "@core/supabase/supabase.service";
import {
  LAUNCHPAD_NETWORK,
  LaunchpadErrorCode,
  toInvestorView,
  toVerificationView,
  type InvestorRow,
  type InvestorView,
  type WalletRow,
} from "./launchpad.types";
import { OnchainIdentityService } from "./chain/onchain-identity.service";
import { VerificationsService } from "./verifications.service";

const TABLE = "launchpad_investors";

/**
 * Neko Pro investors: a wallet whitelisted by an approved KYC/KYB
 * verification. Unlike Launchpad accounts there is no Privy user or embedded
 * wallet; the investor keeps the wallet they connected to Neko Web.
 */
@Injectable()
export class InvestorsService {
  private readonly logger = new Logger(InvestorsService.name);
  /** Wallets with an on-chain registration running in this process. */
  private readonly registering = new Map<string, Promise<InvestorView>>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly verifications: VerificationsService,
    private readonly onchainIdentity: OnchainIdentityService
  ) {}

  async create(
    verificationId: string,
    claimToken: string | undefined,
    walletAddress: string
  ): Promise<InvestorView> {
    const wallet = this.assertWallet(walletAddress);
    const verification = await this.verifications.authorize(
      verificationId,
      claimToken
    );
    if (verification.status !== "approved") {
      throw new ConflictException({
        code: LaunchpadErrorCode.VERIFICATION_NOT_APPROVED,
        message: `Verification is ${verification.status}`,
      });
    }

    const bound = await this.findBy("verification_id", verification.id);
    if (bound) {
      if (bound.wallet_address !== wallet) {
        throw new ConflictException({
          code: LaunchpadErrorCode.VERIFICATION_ALREADY_CLAIMED,
        });
      }
      return toInvestorView(bound, verification);
    }
    if (verification.claimed_at) {
      // Already claimed by a Launchpad account.
      throw new ConflictException({
        code: LaunchpadErrorCode.VERIFICATION_ALREADY_CLAIMED,
      });
    }
    if (await this.findBy("wallet_address", wallet)) {
      throw new ConflictException({
        code: LaunchpadErrorCode.WALLET_ALREADY_VERIFIED,
      });
    }

    const { data, error } = await this.supabase.client
      .from(TABLE)
      .insert({
        wallet_address: wallet,
        verification_id: verification.id,
        network: LAUNCHPAD_NETWORK,
      })
      .select("*")
      .single();
    if (error || !data) throw this.dbError("insert", error);

    const claimed = await this.verifications.markClaimed(verification.id);
    // A few transactions, ~20 s: run them after responding. Neko Pro retries
    // through registerOnchain while `onchain` is false.
    void this.registerOnchain(wallet).catch(() => undefined);
    return toInvestorView(data as InvestorRow, claimed);
  }

  /**
   * Deploys the wallet's identity, adds its KYC/AML claims and registers it,
   * so it can hold vault tokens. Idempotent and safe to call concurrently.
   */
  registerOnchain(walletAddress: string): Promise<InvestorView> {
    const wallet = this.assertWallet(walletAddress);
    const pending = this.registering.get(wallet);
    if (pending) return pending;
    const run = this.doRegisterOnchain(wallet).finally(() =>
      this.registering.delete(wallet)
    );
    this.registering.set(wallet, run);
    return run;
  }

  private async doRegisterOnchain(wallet: string): Promise<InvestorView> {
    const investor = await this.findBy("wallet_address", wallet);
    if (!investor) return this.registerLaunchpadWallet(wallet);
    const verification = await this.verifications.find(
      investor.verification_id
    );
    if (!verification) throw this.dbError("verification_lookup", null);
    if (investor.onchain_registered_at) {
      return toInvestorView(investor, verification);
    }
    if (verification.status !== "approved") {
      throw new ConflictException({
        code: LaunchpadErrorCode.VERIFICATION_NOT_APPROVED,
        message: `Verification is ${verification.status}`,
      });
    }

    const identity = await this.registerIdentity(
      wallet,
      verification.country,
      investor.identity_contract ?? null
    );

    const { data, error } = await this.supabase.client
      .from(TABLE)
      .update({
        identity_contract: identity,
        onchain_registered_at: new Date().toISOString(),
      })
      .eq("id", investor.id)
      .select("*")
      .single();
    if (error || !data) throw this.dbError("onchain_update", error);
    return toInvestorView(data as InvestorRow, verification);
  }

  async get(walletAddress: string): Promise<InvestorView> {
    const investor = await this.findBy(
      "wallet_address",
      this.assertWallet(walletAddress)
    );
    if (!investor) {
      throw new NotFoundException({
        code: LaunchpadErrorCode.INVESTOR_NOT_FOUND,
      });
    }
    const verification = await this.verifications.find(
      investor.verification_id
    );
    if (!verification) throw this.dbError("verification_lookup", null);
    return toInvestorView(investor, verification);
  }

  /**
   * A Launchpad account's embedded wallet: verified through the account, so it
   * has no investor row. Neko Pro lets it in through `/me`; it still needs an
   * on-chain identity to hold vault tokens. Nothing is stored: the registry
   * check makes a repeat call a single read.
   */
  private async registerLaunchpadWallet(wallet: string): Promise<InvestorView> {
    const { data, error } = await this.supabase.client
      .from("launchpad_wallets")
      .select("*")
      .eq("address", wallet)
      .maybeSingle();
    if (error) throw this.dbError("launchpad_wallet_lookup", error);
    if (!data) {
      throw new NotFoundException({
        code: LaunchpadErrorCode.INVESTOR_NOT_FOUND,
      });
    }
    const row = data as WalletRow;
    const verification = await this.verifications.find(row.verification_id);
    if (!verification) throw this.dbError("verification_lookup", null);
    if (verification.status !== "approved") {
      throw new ConflictException({
        code: LaunchpadErrorCode.VERIFICATION_NOT_APPROVED,
        message: `Verification is ${verification.status}`,
      });
    }
    const identity = await this.registerIdentity(
      wallet,
      verification.country,
      null
    );
    return {
      wallet_address: wallet,
      network: row.network,
      whitelisted: true,
      onchain: true,
      identity_contract: identity,
      verification: toVerificationView(verification),
      created_at: row.created_at,
    };
  }

  private async registerIdentity(
    wallet: string,
    country: string | null,
    existing: string | null
  ): Promise<string> {
    try {
      return await this.onchainIdentity.register(wallet, country, existing);
    } catch (error) {
      this.logger.warn({
        event: "launchpad_investor_onchain_failed",
        wallet,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error instanceof HttpException
        ? error
        : new BadGatewayException({
            code: LaunchpadErrorCode.CHAIN_CALL_FAILED,
            message: "On-chain registration failed; try again.",
          });
    }
  }

  private assertWallet(address: string): string {
    const wallet = address.trim();
    if (!StrKey.isValidEd25519PublicKey(wallet)) {
      throw new BadRequestException({ code: ErrorCode.INVALID_WALLET });
    }
    return wallet;
  }

  private async findBy(
    column: "verification_id" | "wallet_address",
    value: string
  ): Promise<InvestorRow | null> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select("*")
      .eq(column, value)
      .maybeSingle();
    if (error) throw this.dbError("lookup", error);
    return (data as InvestorRow | null) ?? null;
  }

  private dbError(op: string, error: unknown) {
    this.logger.error({ event: "launchpad_investor_db_error", op, error });
    return new InternalServerErrorException({ code: ErrorCode.DB_ERROR });
  }
}
