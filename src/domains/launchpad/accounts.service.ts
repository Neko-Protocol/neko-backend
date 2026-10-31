import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ErrorCode } from "@neko-protocol/api-contracts";
import { SupabaseService } from "@core/supabase/supabase.service";
import { PrivyService } from "@core/privy/privy.service";
import { fundWithFriendbot } from "@shared/stellar/friendbot";
import {
  LAUNCHPAD_NETWORK,
  LaunchpadErrorCode,
  toVerificationView,
  type AccountRow,
  type LaunchpadAccountView,
  type VerificationRow,
  type WalletRow,
} from "./launchpad.types";
import { VerificationsService } from "./verifications.service";

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly privy: PrivyService,
    private readonly verifications: VerificationsService,
    private readonly config: ConfigService
  ) {}

  async create(
    verificationId: string,
    claimToken: string | undefined,
    rawEmail: string
  ): Promise<LaunchpadAccountView> {
    const email = rawEmail.trim().toLowerCase();
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

    const existing = await this.findByVerification(verification.id);
    if (existing) {
      if (existing.account.email !== email) {
        throw new ConflictException({
          code: LaunchpadErrorCode.VERIFICATION_ALREADY_CLAIMED,
        });
      }
      return this.view(existing.account, verification, existing.wallet);
    }
    if (verification.claimed_at) {
      // Claimed by a Neko Pro investor wallet instead of an account.
      throw new ConflictException({
        code: LaunchpadErrorCode.VERIFICATION_ALREADY_CLAIMED,
      });
    }

    const { data: emailTaken, error: emailErr } = await this.supabase.client
      .from("launchpad_accounts")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (emailErr) throw this.dbError("email_lookup", emailErr);
    if (emailTaken) {
      throw new ConflictException({ code: LaunchpadErrorCode.EMAIL_IN_USE });
    }

    const privyUser = await this.privy.ensureUserWithStellarWallet(email, {
      launchpad_verification_id: verification.id,
      launchpad_kind: verification.kind,
    });

    const funding = await fundWithFriendbot(
      privyUser.wallet.address,
      this.config.get<string>("LAUNCHPAD_FRIENDBOT_URL")?.trim() || undefined
    );
    if (!funding.funded) {
      // Not fatal: the wallet exists and can be funded later.
      this.logger.warn({
        event: "launchpad_friendbot_failed",
        address: privyUser.wallet.address,
        reason: funding.error,
      });
    }

    const { data: account, error: accountErr } = await this.supabase.client
      .from("launchpad_accounts")
      .insert({
        email,
        privy_user_id: privyUser.userId,
        display_name: verification.business_name ?? verification.full_name,
        verification_id: verification.id,
      })
      .select("*")
      .single();
    if (accountErr || !account)
      throw this.dbError("account_insert", accountErr);

    const { data: wallet, error: walletErr } = await this.supabase.client
      .from("launchpad_wallets")
      .insert({
        account_id: (account as AccountRow).id,
        verification_id: verification.id,
        chain: "stellar",
        network: LAUNCHPAD_NETWORK,
        address: privyUser.wallet.address,
        kind: "embedded",
        provider: "privy",
        provider_wallet_id: privyUser.wallet.walletId,
        funded_at: funding.funded ? new Date().toISOString() : null,
        funding_tx_hash: funding.txHash,
      })
      .select("*")
      .single();
    if (walletErr || !wallet) throw this.dbError("wallet_insert", walletErr);

    const claimed = await this.verifications.markClaimed(verification.id);
    return this.view(account as AccountRow, claimed, wallet as WalletRow);
  }

  async getByAccessToken(accessToken: string): Promise<LaunchpadAccountView> {
    const { userId } = await this.privy.verifyAccessToken(accessToken);
    const found = await this.findBy("privy_user_id", userId);
    if (!found) {
      throw new NotFoundException({
        code: LaunchpadErrorCode.ACCOUNT_NOT_FOUND,
      });
    }
    const { data: verification, error } = await this.supabase.client
      .from("launchpad_verifications")
      .select("*")
      .eq("id", found.account.verification_id)
      .single();
    if (error || !verification) throw this.dbError("me_verification", error);
    return this.view(
      found.account,
      verification as VerificationRow,
      found.wallet
    );
  }

  private findByVerification(verificationId: string) {
    return this.findBy("verification_id", verificationId);
  }

  private async findBy(
    column: "verification_id" | "privy_user_id",
    value: string
  ): Promise<{ account: AccountRow; wallet: WalletRow } | null> {
    const { data: account, error } = await this.supabase.client
      .from("launchpad_accounts")
      .select("*")
      .eq(column, value)
      .maybeSingle();
    if (error) throw this.dbError("account_lookup", error);
    if (!account) return null;
    const { data: wallet, error: walletErr } = await this.supabase.client
      .from("launchpad_wallets")
      .select("*")
      .eq("account_id", (account as AccountRow).id)
      .maybeSingle();
    if (walletErr || !wallet) throw this.dbError("wallet_lookup", walletErr);
    return { account: account as AccountRow, wallet: wallet as WalletRow };
  }

  private view(
    account: AccountRow,
    verification: VerificationRow,
    wallet: WalletRow
  ): LaunchpadAccountView {
    return {
      account: {
        id: account.id,
        email: account.email,
        display_name: account.display_name,
        privy_user_id: account.privy_user_id,
      },
      verification: toVerificationView(verification),
      wallet: {
        address: wallet.address,
        network: wallet.network,
        funded: Boolean(wallet.funded_at),
        funding_tx_hash: wallet.funding_tx_hash,
      },
    };
  }

  private dbError(op: string, error: unknown) {
    this.logger.error({ event: "launchpad_account_db_error", op, error });
    return new InternalServerErrorException({ code: ErrorCode.DB_ERROR });
  }
}
